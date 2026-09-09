// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PayoffVault.sol";
import "./interfaces/IMorpho.sol";

/// @title PayoffVaultFactory
/// @notice Deploys one PayoffVault clone per (owner, pair) and holds the protocol-wide
///         wiring: Morpho, the Uniswap V3 position manager, swap router and factory, the
///         treasury, and the two fee rates. The vault caps the fees in its own code, so
///         this owner can lower them or move the treasury but never charge more than the
///         vault allows.
contract PayoffVaultFactory is Ownable2Step {
    address public immutable implementation;
    address public immutable morpho;
    address public immutable positionManager;
    address public immutable swapRouter;
    address public immutable uniswapFactory;
    address public treasury;
    uint256 public harvestFeeBps;
    uint256 public performanceFeeBps;

    address[] public allVaults;
    mapping(address => address[]) internal vaultsOf;
    mapping(address => bool) public isVault;

    event VaultCreated(address indexed vault, address indexed owner, address indexed operator, address collateralToken, address loanToken, bytes32 marketId);
    event TreasurySet(address treasury);
    event FeesSet(uint256 harvestFeeBps, uint256 performanceFeeBps);

    constructor(
        address morpho_,
        address positionManager_,
        address swapRouter_,
        address uniswapFactory_,
        address treasury_,
        uint256 harvestFeeBps_,
        uint256 performanceFeeBps_
    ) Ownable(msg.sender) {
        require(
            morpho_ != address(0) && positionManager_ != address(0) && swapRouter_ != address(0) && uniswapFactory_ != address(0) && treasury_ != address(0),
            "factory: zero address"
        );
        morpho = morpho_;
        positionManager = positionManager_;
        swapRouter = swapRouter_;
        uniswapFactory = uniswapFactory_;
        treasury = treasury_;
        _setFees(harvestFeeBps_, performanceFeeBps_);
        implementation = address(new PayoffVault());
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "factory: zero address");
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setFees(uint256 harvestFeeBps_, uint256 performanceFeeBps_) external onlyOwner {
        _setFees(harvestFeeBps_, performanceFeeBps_);
    }

    function _setFees(uint256 h, uint256 p) internal {
        // Same caps as PayoffVault.MAX_*: a higher value here would be ignored by the vault anyway.
        require(h <= 500 && p <= 2000, "factory: fee above vault cap");
        harvestFeeBps = h;
        performanceFeeBps = p;
        emit FeesSet(h, p);
    }

    /// @notice Create a vault. The caller becomes its owner.
    function createVault(address operator, MarketParams calldata initialMarket, PayoffVault.Policy calldata policy)
        external returns (address vault)
    {
        vault = Clones.clone(implementation);
        PayoffVault(vault).initialize(address(this), msg.sender, operator, initialMarket, policy);
        allVaults.push(vault);
        vaultsOf[msg.sender].push(vault);
        isVault[vault] = true;
        emit VaultCreated(vault, msg.sender, operator, initialMarket.collateralToken, initialMarket.loanToken, keccak256(abi.encode(initialMarket)));
    }

    function vaultsOfOwner(address owner_) external view returns (address[] memory) {
        return vaultsOf[owner_];
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    function vaults(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 n = allVaults.length;
        if (offset >= n) return new address[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = allVaults[i];
    }
}
