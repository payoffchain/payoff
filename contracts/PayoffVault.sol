// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IMorpho.sol";
import "./interfaces/IUniswapV3.sol";

interface IPayoffFactory {
    function morpho() external view returns (address);
    function positionManager() external view returns (address);
    function swapRouter() external view returns (address);
    function uniswapFactory() external view returns (address);
    function treasury() external view returns (address);
    function harvestFeeBps() external view returns (uint256);
    function performanceFeeBps() external view returns (uint256);
}

/// @title PayoffVault
/// @notice One user's self-repaying loan. Collateral sits in Morpho Blue under this
///         vault's name, the borrowed loan token is put to work in a Uniswap V3 pool of
///         the same pair, and the trading fees that pool pays are used to repay the debt.
///
/// @dev TWO KEYS, TWO ROLES.
///      The OWNER is the human. Only the owner can take value out (withdraw collateral
///      or tokens, always to the owner address), change the policy, swap the operator,
///      or pause. The OPERATOR is the automation key. It may borrow up to the policy's
///      LTV, open and close LP positions IN THE VAULT'S OWN PAIR, harvest fees into the
///      debt, move the debt to another allow-listed Morpho market of the same pair, and
///      repay debt early when LTV crosses the trigger. It can never send a token to any
///      address that is not Morpho, the position manager, the swap router, or the
///      protocol treasury (bounded by the fee caps below). A leaked operator key can
///      make bad trades inside the pair; it cannot steal.
///
/// @dev ONE PAIR PER VAULT. collateralToken/loanToken are fixed at creation and every
///      market and every pool the vault touches must be exactly that pair. It removes a
///      whole class of "operator routed funds into a pool it controls" attacks, at the
///      price of one vault per pair — which is also the natural unit for the UI.
///
/// @dev PRICES ARE POLICED BY THE MARKET ORACLE. Every swap gets a floor derived from
///      the Morpho market's oracle less the policy's slippage ceiling, and every mint
///      (and every owner-initiated burn) first checks the pool's spot price against the
///      same oracle. An operator can pass minOut = 0; the vault tightens it. When the
///      oracle cannot be read the vault FAILS CLOSED: no swap, no mint, no collateral
///      sale; only repaying from idle balance still works. Without that a leaked key
///      could sandwich the vault through a pool it controls.
///
/// @dev FEES. The protocol takes `harvestFeeBps` of harvested trading fees (cap 5%) and
///      `performanceFeeBps` of realized profit above cost basis when an LP position is
///      closed into the loan token (cap 20%). Borrowing, refinancing and liquidation
///      protection carry no protocol fee. The caps live here, not in the factory, so a
///      factory owner cannot raise them past what this code says.
contract PayoffVault is IERC721Receiver, IMorphoFlashLoanCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant ORACLE_SCALE = 1e36;
    uint256 internal constant VIRTUAL_SHARES = 1e6;
    uint256 internal constant VIRTUAL_ASSETS = 1;
    uint256 internal constant Q96 = 2 ** 96;
    uint256 public constant MAX_HARVEST_FEE_BPS = 500;
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2000;

    struct Policy {
        uint256 maxLtvBps;      // no borrow/refinance may leave LTV above this
        uint256 triggerLtvBps;  // protect() may run once LTV is at or above this
        uint256 repayBps;       // protect() aims to repay this share of the debt
        uint256 maxSlippageBps; // how far a swap or a pool price may sit from the oracle
    }

    struct LpPosition {
        uint256 tokenId;
        uint24 fee;
        uint256 costBasis;   // loan token committed at open
        bool open;
    }

    IPayoffFactory public factory;
    address public owner;
    address public pendingOwner;
    address public operator;
    address public collateralToken;
    address public loanToken;
    MarketParams public market;   // current Morpho market
    Policy public policy;
    bool public paused;
    bool internal initialized;

    mapping(bytes32 => bool) public allowedMarkets;
    LpPosition[] internal positions;
    mapping(uint256 => uint256) internal positionIndex; // tokenId => index + 1

    // Stats in loan-token units. Recomputable from events; kept on chain so a UI can
    // show them from one call.
    uint256 public totalBorrowed;
    uint256 public totalRepaid;
    uint256 public totalRepaidFromFees;
    uint256 public totalHarvested;     // loan token that reached the vault from fees, net of protocol fee
    uint256 public totalProtocolFees;  // loan-token side only
    uint256 public refinanceCount;
    uint256 public createdAt;

    event Initialized(address indexed owner, address indexed operator, address collateralToken, address loanToken, bytes32 marketId);
    event OwnershipProposed(address indexed pendingOwner);
    event OwnershipTransferred(address indexed from, address indexed to);
    event OperatorSet(address indexed operator);
    event PolicySet(uint256 maxLtvBps, uint256 triggerLtvBps, uint256 repayBps, uint256 maxSlippageBps);
    event MarketAllowed(bytes32 indexed id, bool allowed);
    event Paused(bool paused);
    event CollateralDeposited(address indexed from, uint256 amount);
    event CollateralWithdrawn(address indexed to, uint256 amount);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);
    event LoanTokenDeposited(address indexed from, uint256 amount);
    event Borrowed(bytes32 indexed marketId, uint256 amount, uint256 ltvBpsAfter);
    event Repaid(bytes32 indexed marketId, uint256 amount, string source);
    event Refinanced(bytes32 indexed fromMarket, bytes32 indexed toMarket, uint256 debt, uint256 collateral, uint256 ltvBpsAfter);
    event LpOpened(uint256 indexed tokenId, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 amount0, uint256 amount1, uint256 costBasis);
    event Harvested(uint256 indexed tokenId, uint256 fee0, uint256 fee1, uint256 protocolFee0, uint256 protocolFee1, uint256 loanTokenOut, uint256 repaid);
    event LpClosed(uint256 indexed tokenId, uint256 amount0, uint256 amount1, uint256 loanTokenOut, uint256 performanceFee, uint256 repaid, bool swappedToLoan);
    event Protected(uint256 ltvBpsBefore, uint256 ltvBpsAfter, uint256 repaid, uint256 collateralSold);
    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, string reason);

    error NotOwner();
    error NotAuthorized();
    error IsPaused();
    error AlreadyInitialized();
    error ZeroAddress();
    error BadPolicy();
    error MarketNotAllowed();
    error WrongPair();
    error LtvTooHigh(uint256 ltvBps, uint256 maxBps);
    error NotAtTrigger(uint256 ltvBps, uint256 triggerBps);
    error UnknownPosition();
    error NothingToDo();
    error Expired();
    error FlashLoanCallerNotMorpho();
    error FlashLoanNotInProgress();
    error PoolPriceOffOracle(uint256 poolPrice, uint256 oraclePrice);
    error NoPool();
    error OracleUnavailable();
    error PolicyAboveLltv(uint256 triggerLtvBps, uint256 lltv);
    error ProtectWorsenedLtv(uint256 before, uint256 after_);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev Owner or operator. The owner can always act; the operator only while not paused.
    modifier onlyAuthorized() {
        if (msg.sender != owner) {
            if (msg.sender != operator) revert NotAuthorized();
            if (paused) revert IsPaused();
        }
        _;
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    // --- setup ---------------------------------------------------------------------

    /// @notice Called once by the factory on a fresh clone.
    function initialize(
        address factory_,
        address owner_,
        address operator_,
        MarketParams calldata initialMarket,
        Policy calldata policy_
    ) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        if (factory_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        factory = IPayoffFactory(factory_);
        owner = owner_;
        operator = operator_;
        collateralToken = initialMarket.collateralToken;
        loanToken = initialMarket.loanToken;
        if (collateralToken == address(0) || loanToken == address(0) || collateralToken == loanToken) revert WrongPair();
        if (initialMarket.oracle == address(0)) revert OracleUnavailable();
        bytes32 id = marketId(initialMarket);
        allowedMarkets[id] = true;
        market = initialMarket;
        _setPolicy(policy_);
        createdAt = block.timestamp;
        emit MarketAllowed(id, true);
        emit Initialized(owner_, operator_, collateralToken, loanToken, id);
    }

    // --- owner controls ------------------------------------------------------------

    /// @notice Two-step ownership transfer: the new owner must accept, so a typo cannot lock the vault.
    function proposeOwner(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipProposed(newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner || pendingOwner == address(0)) revert NotAuthorized();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function setPolicy(Policy calldata policy_) external onlyOwner {
        _setPolicy(policy_);
    }

    function _setPolicy(Policy calldata p) internal {
        // The trigger must sit at or above the borrow ceiling (otherwise protect() fires
        // right after every borrow); everything is in basis points; and a ceiling above
        // 95% would be liquidated by the first tick.
        if (p.maxLtvBps > 9500 || p.triggerLtvBps < p.maxLtvBps || p.triggerLtvBps > BPS) revert BadPolicy();
        // A slippage band of zero would make every swap fail against the pool fee alone.
        if (p.repayBps == 0 || p.repayBps > BPS || p.maxSlippageBps < 10 || p.maxSlippageBps > 2000) revert BadPolicy();
        _requireTriggerBelowLltv(p.triggerLtvBps, market.lltv);
        policy = p;
        emit PolicySet(p.maxLtvBps, p.triggerLtvBps, p.repayBps, p.maxSlippageBps);
    }

    /// @dev protect() is only useful if it can fire before Morpho liquidates: the trigger
    ///      (basis points) must be strictly below the market's LLTV (WAD).
    function _requireTriggerBelowLltv(uint256 triggerBps, uint256 lltv) internal pure {
        if (triggerBps * 1e14 >= lltv) revert PolicyAboveLltv(triggerBps, lltv);
    }

    /// @notice Allow-list a Morpho market the operator may refinance into. Must be the vault's pair.
    function setMarketAllowed(MarketParams calldata params, bool allowed) external onlyOwner {
        if (params.loanToken != loanToken || params.collateralToken != collateralToken) revert WrongPair();
        if (allowed) {
            if (params.oracle == address(0)) revert OracleUnavailable();
            _requireTriggerBelowLltv(policy.triggerLtvBps, params.lltv);
        }
        bytes32 id = marketId(params);
        allowedMarkets[id] = allowed;
        emit MarketAllowed(id, allowed);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit Paused(paused_);
    }

    /// @notice Pull collateral from the owner and supply it to the current market.
    function depositCollateral(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert NothingToDo();
        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);
        _supplyCollateral(amount);
        emit CollateralDeposited(msg.sender, amount);
    }

    /// @notice Pull loan token from the owner into the vault: to LP without borrowing, or to repay.
    function depositLoanToken(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert NothingToDo();
        IERC20(loanToken).safeTransferFrom(msg.sender, address(this), amount);
        emit LoanTokenDeposited(msg.sender, amount);
    }

    /// @notice Withdraw collateral from Morpho to the owner. Morpho refuses to leave the position unhealthy.
    function withdrawCollateral(uint256 amount) external onlyOwner nonReentrant {
        IMorpho(factory.morpho()).withdrawCollateral(market, amount, address(this), owner);
        emit CollateralWithdrawn(owner, amount);
    }

    /// @notice Sweep a token held loose in the vault to the owner. amount 0 = whole balance.
    function withdrawToken(address token, uint256 amount) external onlyOwner nonReentrant {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 amt = amount == 0 ? bal : amount;
        if (amt == 0) revert NothingToDo();
        IERC20(token).safeTransfer(owner, amt);
        emit TokenWithdrawn(token, owner, amt);
    }

    // --- debt ----------------------------------------------------------------------

    /// @notice Borrow `amount` of the loan token into the vault. LTV after must be within policy.
    function borrow(uint256 amount) external onlyAuthorized nonReentrant {
        if (amount == 0) revert NothingToDo();
        IMorpho(factory.morpho()).borrow(market, amount, 0, address(this), address(this));
        totalBorrowed += amount;
        uint256 ltv = ltvBps();
        if (ltv > policy.maxLtvBps) revert LtvTooHigh(ltv, policy.maxLtvBps);
        emit Borrowed(marketId(market), amount, ltv);
    }

    /// @notice Repay from the vault's loan-token balance. amount 0 = as much as possible.
    function repay(uint256 amount) external onlyAuthorized nonReentrant {
        if (_repayFromBalance(amount, "manual") == 0) revert NothingToDo();
    }

    /// @dev Repay min(amount or balance, debt). Returns assets repaid.
    function _repayFromBalance(uint256 amount, string memory source) internal returns (uint256 repaid) {
        IMorpho m = IMorpho(factory.morpho());
        m.accrueInterest(market);
        uint256 debt = debtAssets();
        if (debt == 0) return 0;
        uint256 bal = IERC20(loanToken).balanceOf(address(this));
        uint256 want = amount == 0 ? bal : Math.min(amount, bal);
        if (want == 0) return 0;
        IERC20(loanToken).forceApprove(address(m), want);
        if (want >= debt) {
            // By shares, so the position closes exactly whatever rounding did to `debt`.
            uint128 shares = m.position(Id.wrap(marketId(market)), address(this)).borrowShares;
            (repaid,) = m.repay(market, 0, shares, address(this), "");
        } else {
            (repaid,) = m.repay(market, want, 0, address(this), "");
        }
        IERC20(loanToken).forceApprove(address(m), 0);
        totalRepaid += repaid;
        emit Repaid(marketId(market), repaid, source);
    }

    // --- refinance -----------------------------------------------------------------

    uint8 internal constant FL_NONE = 0;
    uint8 internal constant FL_REFINANCE = 1;
    uint8 internal constant FL_PROTECT = 2;
    uint8 internal flashMode;
    MarketParams internal pendingTarget;

    /// @notice Move the whole position (debt + collateral) to another allow-listed market
    ///         of the same pair, atomically, borrowing the debt from Morpho's flash loan
    ///         for the length of one transaction.
    function refinance(MarketParams calldata target) external onlyAuthorized nonReentrant {
        bytes32 toId = marketId(target);
        bytes32 fromId = marketId(market);
        if (!allowedMarkets[toId]) revert MarketNotAllowed();
        if (target.loanToken != loanToken || target.collateralToken != collateralToken) revert WrongPair();
        if (toId == fromId) revert NothingToDo();
        _requireTriggerBelowLltv(policy.triggerLtvBps, target.lltv);

        IMorpho m = IMorpho(factory.morpho());
        m.accrueInterest(market);
        uint256 debt = debtAssets();
        uint256 coll = collateralAssets();

        pendingTarget = target;
        if (debt > 0) {
            flashMode = FL_REFINANCE;
            m.flashLoan(loanToken, debt, abi.encode(debt, coll, uint256(0), uint24(0), uint256(0)));
            flashMode = FL_NONE;
        } else {
            _moveCollateral(m, coll);
        }
        market = target;
        delete pendingTarget;
        refinanceCount += 1;
        uint256 ltv = ltvBps();
        if (ltv > policy.maxLtvBps) revert LtvTooHigh(ltv, policy.maxLtvBps);
        emit Refinanced(fromId, toId, debt, coll, ltv);
    }

    /// @dev Morpho hands the vault `assets` of loan token and pulls them back after this
    ///      returns. Two uses: moving the whole position to another market (refinance),
    ///      and repaying part of the debt before the collateral that backed it is sold
    ///      (protect) — collateral cannot be withdrawn while it still backs debt.
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external override {
        IMorpho m = IMorpho(factory.morpho());
        if (msg.sender != address(m)) revert FlashLoanCallerNotMorpho();
        uint8 mode = flashMode;
        if (mode == FL_NONE) revert FlashLoanNotInProgress();
        (uint256 amount, uint256 coll, uint256 sell, uint24 swapFee, uint256 deadline) =
            abi.decode(data, (uint256, uint256, uint256, uint24, uint256));

        if (mode == FL_REFINANCE) {
            // 1. repay everything in the old market (by shares: exact)
            uint128 shares = m.position(Id.wrap(marketId(market)), address(this)).borrowShares;
            IERC20(loanToken).forceApprove(address(m), assets);
            m.repay(market, 0, shares, address(this), "");
            // 2. move the collateral across
            _moveCollateral(m, coll);
            // 3. borrow the same debt in the new market, into this vault
            m.borrow(pendingTarget, amount, 0, address(this), address(this));
        } else {
            // 1. repay first, so the collateral becomes free to withdraw
            _repayFromBalance(amount, "protect");
            // 2. sell the collateral that backed it; the oracle floor guards the price
            m.withdrawCollateral(market, sell, address(this), address(this));
            _swap(collateralToken, loanToken, swapFee, sell, 0, deadline, "protect");
        }
        // 4. let Morpho pull the flash loan back
        IERC20(loanToken).forceApprove(address(m), assets);
    }

    function _moveCollateral(IMorpho m, uint256 coll) internal {
        if (coll == 0) return;
        m.withdrawCollateral(market, coll, address(this), address(this));
        IERC20(collateralToken).forceApprove(address(m), coll);
        m.supplyCollateral(pendingTarget, coll, address(this), "");
    }

    function _supplyCollateral(uint256 amount) internal {
        IMorpho m = IMorpho(factory.morpho());
        IERC20(collateralToken).forceApprove(address(m), amount);
        m.supplyCollateral(market, amount, address(this), "");
    }

    // --- liquidity -----------------------------------------------------------------

    struct OpenParams {
        uint24 fee;              // pool fee tier; the pool is (collateralToken, loanToken, fee)
        int24 tickLower;
        int24 tickUpper;
        uint256 loanAmount;      // loan token to commit (must already be in the vault)
        uint256 swapAmount;      // part of loanAmount to swap into collateral first (0 = single-sided loan token)
        uint256 swapMinOut;      // floor for that swap (the oracle floor applies on top)
        uint256 amount0Min;      // mint floors, in pool token order
        uint256 amount1Min;
        uint256 deadline;
    }

    /// @notice Put loan token to work in the pair's Uniswap V3 pool.
    function openLp(OpenParams calldata p) external onlyAuthorized nonReentrant checkDeadline(p.deadline) returns (uint256 tokenId) {
        if (p.loanAmount == 0 || p.swapAmount > p.loanAmount) revert NothingToDo();
        _checkPoolPrice(p.fee);
        uint256 collateralLeg;
        if (p.swapAmount > 0) {
            collateralLeg = _swap(loanToken, collateralToken, p.fee, p.swapAmount, p.swapMinOut, p.deadline, "openLp");
            // The swap moved the pool. A thin pool could now sit far from the oracle and
            // the mint would be arbed straight back; check again before minting.
            _checkPoolPrice(p.fee);
        }
        uint256 loanLeg = p.loanAmount - p.swapAmount;

        (address token0, address token1) = _sorted();
        (uint256 a0, uint256 a1) = token0 == loanToken ? (loanLeg, collateralLeg) : (collateralLeg, loanLeg);
        INonfungiblePositionManager pm = INonfungiblePositionManager(factory.positionManager());
        if (a0 > 0) IERC20(token0).forceApprove(address(pm), a0);
        if (a1 > 0) IERC20(token1).forceApprove(address(pm), a1);
        uint128 liquidity;
        uint256 used0;
        uint256 used1;
        (tokenId, liquidity, used0, used1) = pm.mint(INonfungiblePositionManager.MintParams({
            token0: token0, token1: token1, fee: p.fee,
            tickLower: p.tickLower, tickUpper: p.tickUpper,
            amount0Desired: a0, amount1Desired: a1,
            amount0Min: p.amount0Min, amount1Min: p.amount1Min,
            recipient: address(this), deadline: p.deadline
        }));
        if (a0 > 0) IERC20(token0).forceApprove(address(pm), 0);
        if (a1 > 0) IERC20(token1).forceApprove(address(pm), 0);

        // Cost basis is what the position actually took: the loan leg it used plus the
        // share of the swapped amount that went in. Whatever mint returned stays in the
        // vault and is not part of this position's profit calculation.
        (uint256 usedLoan, uint256 usedColl) = token0 == loanToken ? (used0, used1) : (used1, used0);
        uint256 costBasis = usedLoan + (collateralLeg == 0 ? 0 : p.swapAmount.mulDiv(usedColl, collateralLeg));
        positions.push(LpPosition({ tokenId: tokenId, fee: p.fee, costBasis: costBasis, open: true }));
        positionIndex[tokenId] = positions.length;
        emit LpOpened(tokenId, p.fee, p.tickLower, p.tickUpper, liquidity, used0, used1, costBasis);
    }

    /// @notice Collect the fees a position has earned, take the protocol's cut, turn the
    ///         collateral-side fees into loan token, and repay debt with all of it.
    /// @param minOut floor for the collateral-side swap (the oracle floor applies on top)
    function harvest(uint256 tokenId, uint256 minOut, uint256 deadline)
        external onlyAuthorized nonReentrant checkDeadline(deadline) returns (uint256 repaid)
    {
        LpPosition storage pos = _position(tokenId);
        (uint256 c0, uint256 c1) = _collect(tokenId);
        if (c0 == 0 && c1 == 0) revert NothingToDo();
        (address token0,) = _sorted();
        (uint256 feeLoan, uint256 feeColl) = token0 == loanToken ? (c0, c1) : (c1, c0);
        (uint256 pfLoan, uint256 pfColl) = _takeProtocolFee(feeLoan, feeColl);
        uint256 loanOut = feeLoan - pfLoan;
        if (feeColl > pfColl) {
            loanOut += _swap(collateralToken, loanToken, pos.fee, feeColl - pfColl, minOut, deadline, "harvest");
        }
        totalHarvested += loanOut;
        repaid = _repayFromBalance(loanOut, "fees");
        totalRepaidFromFees += repaid;
        (uint256 pf0, uint256 pf1) = token0 == loanToken ? (pfLoan, pfColl) : (pfColl, pfLoan);
        emit Harvested(tokenId, c0, c1, pf0, pf1, loanOut, repaid);
    }

    /// @notice Close a position entirely. With swapToLoan the collateral leg is sold into
    ///         the loan token, a performance fee is taken on profit above cost basis, and
    ///         the debt is repaid with everything. Without it the two legs stay in the vault
    ///         (the owner may withdraw them, or the operator may re-deploy).
    function closeLp(uint256 tokenId, uint256 amount0Min, uint256 amount1Min, bool swapToLoan, uint256 swapMinOut, uint256 deadline)
        external onlyAuthorized nonReentrant checkDeadline(deadline) returns (uint256 loanOut, uint256 repaid)
    {
        (loanOut, repaid) = _close(tokenId, amount0Min, amount1Min, swapToLoan, swapMinOut, deadline, true);
    }

    /// @dev checkSpot compares the pool to the oracle before burning. protect() passes
    ///      false: equity oracles hold the last print over nights and weekends while the
    ///      pool keeps trading, and protection must still be able to run then. Burning at a
    ///      skewed spot only changes the token mix that comes out; the swap that follows is
    ///      still floored by the oracle, so no value leaks through the burn itself.
    function _close(uint256 tokenId, uint256 amount0Min, uint256 amount1Min, bool swapToLoan, uint256 swapMinOut, uint256 deadline, bool checkSpot)
        internal returns (uint256 loanOut, uint256 repaid)
    {
        LpPosition storage pos = _position(tokenId);
        if (checkSpot) _checkPoolPrice(pos.fee);
        INonfungiblePositionManager pm = INonfungiblePositionManager(factory.positionManager());
        (,,,,,,, uint128 liquidity,,,,) = pm.positions(tokenId);
        if (liquidity > 0) {
            pm.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: tokenId, liquidity: liquidity, amount0Min: amount0Min, amount1Min: amount1Min, deadline: deadline
            }));
        }
        (uint256 c0, uint256 c1) = _collect(tokenId);
        pm.burn(tokenId);
        pos.open = false;

        (address token0,) = _sorted();
        (uint256 outLoan, uint256 outColl) = token0 == loanToken ? (c0, c1) : (c1, c0);
        uint256 perf;
        if (swapToLoan) {
            loanOut = outLoan;
            if (outColl > 0) loanOut += _swap(collateralToken, loanToken, pos.fee, outColl, swapMinOut, deadline, "closeLp");
            if (loanOut > pos.costBasis) {
                perf = (loanOut - pos.costBasis) * Math.min(factory.performanceFeeBps(), MAX_PERFORMANCE_FEE_BPS) / BPS;
                if (perf > 0) {
                    IERC20(loanToken).safeTransfer(factory.treasury(), perf);
                    totalProtocolFees += perf;
                    loanOut -= perf;
                }
            }
            repaid = _repayFromBalance(loanOut, "closeLp");
        }
        emit LpClosed(tokenId, c0, c1, loanOut, perf, repaid, swapToLoan);
    }

    // --- liquidation protection ----------------------------------------------------

    /// @notice Bring LTV down once it is at or above the trigger: first with loan token
    ///         already in the vault, then by closing the given LP positions into the loan
    ///         token, then by selling up to `maxCollateralToSell` of collateral. Stops as
    ///         soon as `policy.repayBps` of the debt has been repaid.
    function protect(uint256[] calldata tokenIds, uint256 maxCollateralToSell, uint24 swapFee, uint256 deadline)
        external onlyAuthorized nonReentrant checkDeadline(deadline)
    {
        IMorpho m = IMorpho(factory.morpho());
        m.accrueInterest(market);
        uint256 before = ltvBps();
        if (before < policy.triggerLtvBps) revert NotAtTrigger(before, policy.triggerLtvBps);
        uint256 target = debtAssets() * policy.repayBps / BPS;
        uint256 repaid = _repayFromBalance(target, "protect");

        for (uint256 i = 0; i < tokenIds.length && repaid < target; i++) {
            (, uint256 r) = _close(tokenIds[i], 0, 0, true, 0, deadline, false);
            repaid += r;
        }

        uint256 sold;
        if (repaid < target && maxCollateralToSell > 0) {
            // The collateral cannot leave Morpho while it backs the debt, so the repayment
            // is flash-borrowed, the collateral is freed and sold, and the sale pays the
            // flash loan back — one transaction. The amount sold is bounded by what the
            // repayment needs at the worst price the policy accepts, whatever the caller
            // asked for: an operator cannot use protection to liquidate the vault.
            uint256 need = target - repaid;
            uint256 px = _oraclePrice();
            if (px == 0) revert OracleUnavailable();
            uint256 enough = need.mulDiv(ORACLE_SCALE, px, Math.Rounding.Ceil).mulDiv(BPS, BPS - policy.maxSlippageBps, Math.Rounding.Ceil) + 1;
            sold = Math.min(maxCollateralToSell, enough);
            flashMode = FL_PROTECT;
            m.flashLoan(loanToken, need, abi.encode(need, uint256(0), sold, swapFee, deadline));
            flashMode = FL_NONE;
            repaid += need;
        }
        if (repaid == 0) revert NothingToDo();
        uint256 after_ = ltvBps();
        // Selling collateral to repay only helps while LTV < 100%; past that, or with a bad
        // fill, it would leave the position closer to liquidation than before. Refuse.
        if (after_ > before) revert ProtectWorsenedLtv(before, after_);
        emit Protected(before, after_, repaid, sold);
    }

    // --- internals -----------------------------------------------------------------

    function _position(uint256 tokenId) internal view returns (LpPosition storage pos) {
        uint256 idx = positionIndex[tokenId];
        if (idx == 0) revert UnknownPosition();
        pos = positions[idx - 1];
        if (!pos.open) revert UnknownPosition();
    }

    function _collect(uint256 tokenId) internal returns (uint256, uint256) {
        return INonfungiblePositionManager(factory.positionManager()).collect(INonfungiblePositionManager.CollectParams({
            tokenId: tokenId, recipient: address(this), amount0Max: type(uint128).max, amount1Max: type(uint128).max
        }));
    }

    function _takeProtocolFee(uint256 feeLoan, uint256 feeColl) internal returns (uint256 pfLoan, uint256 pfColl) {
        uint256 b = Math.min(factory.harvestFeeBps(), MAX_HARVEST_FEE_BPS);
        if (b == 0) return (0, 0);
        address t = factory.treasury();
        pfLoan = feeLoan * b / BPS;
        pfColl = feeColl * b / BPS;
        if (pfLoan > 0) IERC20(loanToken).safeTransfer(t, pfLoan);
        if (pfColl > 0) IERC20(collateralToken).safeTransfer(t, pfColl);
        totalProtocolFees += pfLoan;
    }

    /// @dev Every swap the vault makes goes through here: only between the pair's two
    ///      tokens, only via the configured router, never below the oracle floor, and
    ///      never after the caller's deadline (SwapRouter02 has no deadline of its own).
    function _swap(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 minOut, uint256 deadline, string memory reason)
        internal returns (uint256 amountOut)
    {
        if (block.timestamp > deadline) revert Expired();
        uint256 floor = Math.max(minOut, _oracleFloor(tokenIn, amountIn));
        ISwapRouter router = ISwapRouter(factory.swapRouter());
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        amountOut = router.exactInputSingle(ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn, tokenOut: tokenOut, fee: fee, recipient: address(this),
            amountIn: amountIn, amountOutMinimum: floor, sqrtPriceLimitX96: 0
        }));
        IERC20(tokenIn).forceApprove(address(router), 0);
        emit Swapped(tokenIn, tokenOut, amountIn, amountOut, reason);
    }

    /// @dev Oracle-implied output less maxSlippageBps. Zero when the oracle cannot be read.
    function _oracleFloor(address tokenIn, uint256 amountIn) internal view returns (uint256) {
        uint256 px = _oraclePrice();
        // Fail closed. With no price there is no floor, and "no floor" is exactly the
        // moment a leaked operator key could route the whole balance through a pool it
        // controls. Better that the vault does nothing until the oracle answers.
        if (px == 0) revert OracleUnavailable();
        uint256 fair = tokenIn == collateralToken
            ? amountIn.mulDiv(px, ORACLE_SCALE)
            : amountIn.mulDiv(ORACLE_SCALE, px);
        return fair * (BPS - policy.maxSlippageBps) / BPS;
    }

    /// @dev The pool's spot price, as loan per collateral scaled 1e36 like the oracle,
    ///      must sit within maxSlippageBps of the oracle. Skipped when the oracle is unreadable.
    function _checkPoolPrice(uint24 fee) internal view {
        uint256 px = _oraclePrice();
        if (px == 0) revert OracleUnavailable();
        (address token0, address token1) = _sorted();
        address pool = IUniswapV3Factory(factory.uniswapFactory()).getPool(token0, token1, fee);
        if (pool == address(0)) revert NoPool();
        (uint160 sqrtP,,,,,,) = IUniswapV3Pool(pool).slot0();
        uint256 s = uint256(sqrtP);
        uint256 poolPx;
        if (token0 == collateralToken) {
            // token1 per token0 = s^2 / 2^192
            poolPx = Math.mulDiv(Math.mulDiv(s, s, Q96), ORACLE_SCALE, Q96);
        } else {
            // token0 per token1 = 2^192 / s^2
            poolPx = Math.mulDiv(Math.mulDiv(Q96, Q96, s), ORACLE_SCALE, s);
        }
        uint256 lo = px * (BPS - policy.maxSlippageBps) / BPS;
        uint256 hi = px * (BPS + policy.maxSlippageBps) / BPS;
        if (poolPx < lo || poolPx > hi) revert PoolPriceOffOracle(poolPx, px);
    }

    function _oraclePrice() internal view returns (uint256) {
        if (market.oracle == address(0)) return 0;
        try IOracle(market.oracle).price() returns (uint256 p) { return p; } catch { return 0; }
    }

    function _sorted() internal view returns (address token0, address token1) {
        (token0, token1) = collateralToken < loanToken ? (collateralToken, loanToken) : (loanToken, collateralToken);
    }

    // --- views ---------------------------------------------------------------------

    function marketId(MarketParams memory p) public pure returns (bytes32) {
        return keccak256(abi.encode(p));
    }

    function currentMarketId() external view returns (bytes32) {
        return marketId(market);
    }

    function currentMarket() external view returns (MarketParams memory) {
        return market;
    }

    /// @notice Debt in loan-token units, rounded up, as of the last accrual.
    function debtAssets() public view returns (uint256) {
        IMorpho m = IMorpho(factory.morpho());
        Id id = Id.wrap(marketId(market));
        Position memory pos = m.position(id, address(this));
        if (pos.borrowShares == 0) return 0;
        Market memory mk = m.market(id);
        return uint256(pos.borrowShares).mulDiv(
            uint256(mk.totalBorrowAssets) + VIRTUAL_ASSETS,
            uint256(mk.totalBorrowShares) + VIRTUAL_SHARES,
            Math.Rounding.Ceil
        );
    }

    function collateralAssets() public view returns (uint256) {
        return IMorpho(factory.morpho()).position(Id.wrap(marketId(market)), address(this)).collateral;
    }

    /// @notice Loan-to-value in basis points. type(uint256).max when there is debt and no priced collateral.
    function ltvBps() public view returns (uint256) {
        uint256 debt = debtAssets();
        if (debt == 0) return 0;
        uint256 coll = collateralAssets();
        uint256 px = _oraclePrice();
        if (coll == 0 || px == 0) return type(uint256).max;
        uint256 collValue = coll.mulDiv(px, ORACLE_SCALE);
        if (collValue == 0) return type(uint256).max;
        return debt * BPS / collValue;
    }

    function oraclePrice() external view returns (uint256) {
        return _oraclePrice();
    }

    function openPositions() external view returns (uint256[] memory ids) {
        uint256 n;
        for (uint256 i = 0; i < positions.length; i++) if (positions[i].open) n++;
        ids = new uint256[](n);
        uint256 j;
        for (uint256 i = 0; i < positions.length; i++) if (positions[i].open) ids[j++] = positions[i].tokenId;
    }

    function positionCount() external view returns (uint256) {
        return positions.length;
    }

    function positionAt(uint256 i) external view returns (LpPosition memory) {
        return positions[i];
    }

    function positionInfo(uint256 tokenId) external view returns (LpPosition memory) {
        uint256 idx = positionIndex[tokenId];
        if (idx == 0) revert UnknownPosition();
        return positions[idx - 1];
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
