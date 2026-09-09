// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IMorpho.sol";
import "../interfaces/IUniswapV3.sol";

/// @dev Test doubles. They reproduce the parts of Morpho Blue and Uniswap V3 the vault
///      depends on (share maths, health checks, flash loan callback shape, NFT position
///      accounting) with knobs the tests can turn (price, interest, fees earned).

contract MockERC20 is ERC20 {
    uint8 internal immutable _dec;
    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) { _dec = d; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract MockOracle is IOracle {
    uint256 public p;
    bool public broken;
    constructor(uint256 p_) { p = p_; }
    function set(uint256 p_) external { p = p_; }
    function setBroken(bool b) external { broken = b; }
    function price() external view returns (uint256) {
        require(!broken, "oracle: broken");
        return p;
    }
}

contract MockIrm is IIrm {
    uint256 public rate; // per second, 1e18
    constructor(uint256 r) { rate = r; }
    function set(uint256 r) external { rate = r; }
    function borrowRateView(MarketParams memory, Market memory) external view returns (uint256) { return rate; }
}

/// @dev Morpho Blue subset with the same virtual-share maths and health rule.
contract MockMorpho is IMorpho {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 constant VIRTUAL_SHARES = 1e6;
    uint256 constant VIRTUAL_ASSETS = 1;
    uint256 constant ORACLE_SCALE = 1e36;
    uint256 constant WAD = 1e18;

    mapping(Id => MarketParams) internal params;
    mapping(Id => Market) internal markets;
    mapping(Id => mapping(address => Position)) internal positions;
    bool public flashLoanEnabled = true;

    function createMarket(MarketParams memory p) external returns (Id id) {
        id = Id.wrap(keccak256(abi.encode(p)));
        params[id] = p;
        markets[id].lastUpdate = uint128(block.timestamp);
    }

    /// @dev Lender side, so markets have liquidity to borrow.
    function supply(MarketParams memory p, uint256 assets, uint256, address onBehalf, bytes memory) external returns (uint256, uint256) {
        Id id = _id(p);
        Market storage m = markets[id];
        uint256 shares = assets.mulDiv(m.totalSupplyShares + VIRTUAL_SHARES, m.totalSupplyAssets + VIRTUAL_ASSETS);
        m.totalSupplyAssets += uint128(assets);
        m.totalSupplyShares += uint128(shares);
        positions[id][onBehalf].supplyShares += shares;
        IERC20(p.loanToken).safeTransferFrom(msg.sender, address(this), assets);
        return (assets, shares);
    }

    function withdraw(MarketParams memory, uint256, uint256, address, address) external pure returns (uint256, uint256) {
        revert("mock: not implemented");
    }

    function supplyCollateral(MarketParams memory p, uint256 assets, address onBehalf, bytes memory) external {
        Id id = _id(p);
        positions[id][onBehalf].collateral += uint128(assets);
        IERC20(p.collateralToken).safeTransferFrom(msg.sender, address(this), assets);
    }

    function withdrawCollateral(MarketParams memory p, uint256 assets, address onBehalf, address receiver) external {
        Id id = _id(p);
        require(msg.sender == onBehalf, "mock: unauthorized");
        positions[id][onBehalf].collateral -= uint128(assets);
        require(_healthy(id, onBehalf), "mock: insufficient collateral");
        IERC20(p.collateralToken).safeTransfer(receiver, assets);
    }

    function borrow(MarketParams memory p, uint256 assets, uint256 shares, address onBehalf, address receiver) external returns (uint256, uint256) {
        Id id = _id(p);
        require(msg.sender == onBehalf, "mock: unauthorized");
        Market storage m = markets[id];
        require((assets == 0) != (shares == 0), "mock: inconsistent input");
        if (assets > 0) shares = assets.mulDiv(m.totalBorrowShares + VIRTUAL_SHARES, m.totalBorrowAssets + VIRTUAL_ASSETS, Math.Rounding.Ceil);
        else assets = shares.mulDiv(m.totalBorrowAssets + VIRTUAL_ASSETS, m.totalBorrowShares + VIRTUAL_SHARES);
        positions[id][onBehalf].borrowShares += uint128(shares);
        m.totalBorrowShares += uint128(shares);
        m.totalBorrowAssets += uint128(assets);
        require(_healthy(id, onBehalf), "mock: insufficient collateral");
        require(m.totalBorrowAssets <= m.totalSupplyAssets, "mock: insufficient liquidity");
        IERC20(p.loanToken).safeTransfer(receiver, assets);
        return (assets, shares);
    }

    function repay(MarketParams memory p, uint256 assets, uint256 shares, address onBehalf, bytes memory) external returns (uint256, uint256) {
        Id id = _id(p);
        Market storage m = markets[id];
        require((assets == 0) != (shares == 0), "mock: inconsistent input");
        if (assets > 0) shares = assets.mulDiv(m.totalBorrowShares + VIRTUAL_SHARES, m.totalBorrowAssets + VIRTUAL_ASSETS);
        else assets = shares.mulDiv(m.totalBorrowAssets + VIRTUAL_ASSETS, m.totalBorrowShares + VIRTUAL_SHARES, Math.Rounding.Ceil);
        positions[id][onBehalf].borrowShares -= uint128(shares);
        m.totalBorrowShares -= uint128(shares);
        m.totalBorrowAssets = uint128(Math.min(assets, m.totalBorrowAssets) == assets ? m.totalBorrowAssets - assets : 0);
        IERC20(p.loanToken).safeTransferFrom(msg.sender, address(this), assets);
        return (assets, shares);
    }

    function flashLoan(address token, uint256 assets, bytes calldata data) external {
        require(flashLoanEnabled, "mock: flash loans off");
        IERC20(token).safeTransfer(msg.sender, assets);
        IMorphoFlashLoanCallback(msg.sender).onMorphoFlashLoan(assets, data);
        IERC20(token).safeTransferFrom(msg.sender, address(this), assets);
    }

    function accrueInterest(MarketParams memory) external {}

    /// @dev Test knob: pretend `assets` of interest accrued on a market.
    function addInterest(MarketParams memory p, uint256 assets) external {
        Market storage m = markets[_id(p)];
        m.totalBorrowAssets += uint128(assets);
        m.totalSupplyAssets += uint128(assets);
    }

    function setFlashLoanEnabled(bool on) external { flashLoanEnabled = on; }

    function position(Id id, address user) external view returns (Position memory) { return positions[id][user]; }
    function market(Id id) external view returns (Market memory) { return markets[id]; }
    function idToMarketParams(Id id) external view returns (MarketParams memory) { return params[id]; }

    function _id(MarketParams memory p) internal pure returns (Id) { return Id.wrap(keccak256(abi.encode(p))); }

    function _healthy(Id id, address user) internal view returns (bool) {
        Position memory pos = positions[id][user];
        if (pos.borrowShares == 0) return true;
        MarketParams memory p = params[id];
        Market memory m = markets[id];
        uint256 borrowed = uint256(pos.borrowShares).mulDiv(m.totalBorrowAssets + VIRTUAL_ASSETS, m.totalBorrowShares + VIRTUAL_SHARES, Math.Rounding.Ceil);
        uint256 collPrice = IOracle(p.oracle).price();
        uint256 maxBorrow = uint256(pos.collateral).mulDiv(collPrice, ORACLE_SCALE).mulDiv(p.lltv, WAD);
        return maxBorrow >= borrowed;
    }
}

contract MockPool is IUniswapV3Pool {
    uint160 public sqrtP;
    address public immutable t0;
    address public immutable t1;
    uint24 public immutable f;
    constructor(address a, address b, uint24 fee_, uint160 s) { t0 = a; t1 = b; f = fee_; sqrtP = s; }
    function setSqrtPrice(uint160 s) external { sqrtP = s; }
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) { return (sqrtP, 0, 0, 0, 0, 0, true); }
    function liquidity() external pure returns (uint128) { return 1; }
    function fee() external view returns (uint24) { return f; }
    function token0() external view returns (address) { return t0; }
    function token1() external view returns (address) { return t1; }
}

contract MockUniFactory is IUniswapV3Factory {
    mapping(bytes32 => address) public pools;
    function create(address a, address b, uint24 fee, uint160 sqrtP) external returns (address pool) {
        (address x, address y) = a < b ? (a, b) : (b, a);
        pool = address(new MockPool(x, y, fee, sqrtP));
        pools[keccak256(abi.encode(x, y, fee))] = pool;
    }
    function getPool(address a, address b, uint24 fee) external view returns (address) {
        (address x, address y) = a < b ? (a, b) : (b, a);
        return pools[keccak256(abi.encode(x, y, fee))];
    }
}

/// @dev Swaps at a fixed price: `price36` = loan per collateral, 1e36-scaled like the oracle.
contract MockSwapRouter is ISwapRouter {
    using SafeERC20 for IERC20;
    using Math for uint256;
    address public immutable collateral;
    address public immutable loan;
    uint256 public price36;
    uint256 public spreadBps; // haircut applied on every swap, to simulate slippage
    constructor(address c, address l, uint256 p) { collateral = c; loan = l; price36 = p; }
    function setPrice(uint256 p) external { price36 = p; }
    function setSpread(uint256 bps) external { spreadBps = bps; }
    function exactInputSingle(ExactInputSingleParams calldata q) external payable returns (uint256 amountOut) {
        uint256 fair = q.tokenIn == collateral ? q.amountIn.mulDiv(price36, 1e36) : q.amountIn.mulDiv(1e36, price36);
        amountOut = fair * (10_000 - spreadBps) / 10_000;
        require(amountOut >= q.amountOutMinimum, "Too little received");
        IERC20(q.tokenIn).safeTransferFrom(msg.sender, address(this), q.amountIn);
        IERC20(q.tokenOut).safeTransfer(q.recipient, amountOut);
    }
}

/// @dev Position NFT accounting without an AMM: liquidity = amount0 + amount1 held,
///      fees are credited by the test through setFees(). Calls onERC721Received on mint
///      like the real manager does.
contract MockPositionManager is INonfungiblePositionManager {
    using SafeERC20 for IERC20;
    struct P { address token0; address token1; uint24 fee; int24 tl; int24 tu; uint128 liq; uint256 a0; uint256 a1; uint128 owed0; uint128 owed1; address owner; bool exists; }
    mapping(uint256 => P) public pos;
    uint256 public nextId = 1;
    address public immutable f;
    constructor(address factory_) { f = factory_; }
    function factory() external view returns (address) { return f; }

    function mint(MintParams calldata m) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) {
        require(block.timestamp <= m.deadline, "pm: expired");
        require(m.amount0Desired >= m.amount0Min && m.amount1Desired >= m.amount1Min, "pm: slippage");
        if (m.amount0Desired > 0) IERC20(m.token0).safeTransferFrom(msg.sender, address(this), m.amount0Desired);
        if (m.amount1Desired > 0) IERC20(m.token1).safeTransferFrom(msg.sender, address(this), m.amount1Desired);
        tokenId = nextId++;
        liquidity = uint128(m.amount0Desired + m.amount1Desired);
        pos[tokenId] = P(m.token0, m.token1, m.fee, m.tickLower, m.tickUpper, liquidity, m.amount0Desired, m.amount1Desired, 0, 0, m.recipient, true);
        amount0 = m.amount0Desired;
        amount1 = m.amount1Desired;
        if (m.recipient.code.length > 0) {
            require(IERC721Receiver(m.recipient).onERC721Received(msg.sender, address(0), tokenId, "") == IERC721Receiver.onERC721Received.selector, "pm: receiver");
        }
    }

    /// @dev Test knob: fees earned. Mints the tokens to the manager so collect can pay them.
    function setFees(uint256 tokenId, uint256 f0, uint256 f1) external {
        P storage p = pos[tokenId];
        require(p.exists, "pm: no position");
        MockERC20(p.token0).mint(address(this), f0);
        MockERC20(p.token1).mint(address(this), f1);
        p.owed0 += uint128(f0);
        p.owed1 += uint128(f1);
    }

    /// @dev Test knob: change what the position is worth (impermanent gain/loss).
    function setUnderlying(uint256 tokenId, uint256 a0, uint256 a1) external {
        P storage p = pos[tokenId];
        require(p.exists, "pm: no position");
        if (a0 > p.a0) MockERC20(p.token0).mint(address(this), a0 - p.a0);
        if (a1 > p.a1) MockERC20(p.token1).mint(address(this), a1 - p.a1);
        p.a0 = a0; p.a1 = a1;
        p.liq = uint128(a0 + a1);
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata d) external payable returns (uint256 amount0, uint256 amount1) {
        P storage p = pos[d.tokenId];
        require(p.exists && p.owner == msg.sender, "pm: not owner");
        require(block.timestamp <= d.deadline, "pm: expired");
        amount0 = p.a0 * d.liquidity / p.liq;
        amount1 = p.a1 * d.liquidity / p.liq;
        require(amount0 >= d.amount0Min && amount1 >= d.amount1Min, "pm: slippage");
        p.a0 -= amount0; p.a1 -= amount1; p.liq -= d.liquidity;
        p.owed0 += uint128(amount0); p.owed1 += uint128(amount1);
    }

    function collect(CollectParams calldata c) external payable returns (uint256 amount0, uint256 amount1) {
        P storage p = pos[c.tokenId];
        require(p.exists && p.owner == msg.sender, "pm: not owner");
        amount0 = c.amount0Max < p.owed0 ? c.amount0Max : p.owed0;
        amount1 = c.amount1Max < p.owed1 ? c.amount1Max : p.owed1;
        p.owed0 -= uint128(amount0); p.owed1 -= uint128(amount1);
        if (amount0 > 0) IERC20(p.token0).safeTransfer(c.recipient, amount0);
        if (amount1 > 0) IERC20(p.token1).safeTransfer(c.recipient, amount1);
    }

    function burn(uint256 tokenId) external payable {
        P storage p = pos[tokenId];
        require(p.exists && p.owner == msg.sender, "pm: not owner");
        require(p.liq == 0 && p.owed0 == 0 && p.owed1 == 0, "Not cleared");
        delete pos[tokenId];
    }

    function positions(uint256 tokenId) external view returns (
        uint96, address, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity,
        uint256, uint256, uint128 tokensOwed0, uint128 tokensOwed1
    ) {
        P storage p = pos[tokenId];
        require(p.exists, "Invalid token ID");
        return (0, address(0), p.token0, p.token1, p.fee, p.tl, p.tu, p.liq, 0, 0, p.owed0, p.owed1);
    }
}
