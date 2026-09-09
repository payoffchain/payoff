// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Subset of Morpho Blue (github.com/morpho-org/morpho-blue) the vault talks to.
///      Market ids are keccak256(abi.encode(MarketParams)).
type Id is bytes32;

struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

struct Position {
    uint256 supplyShares;
    uint128 borrowShares;
    uint128 collateral;
}

struct Market {
    uint128 totalSupplyAssets;
    uint128 totalSupplyShares;
    uint128 totalBorrowAssets;
    uint128 totalBorrowShares;
    uint128 lastUpdate;
    uint128 fee;
}

interface IMorpho {
    function supplyCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, bytes memory data) external;
    function withdrawCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, address receiver) external;
    function borrow(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external returns (uint256 assetsBorrowed, uint256 sharesBorrowed);
    function repay(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external returns (uint256 assetsRepaid, uint256 sharesRepaid);
    function supply(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external returns (uint256 assetsSupplied, uint256 sharesSupplied);
    function withdraw(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn);
    function flashLoan(address token, uint256 assets, bytes calldata data) external;
    function accrueInterest(MarketParams memory marketParams) external;
    function position(Id id, address user) external view returns (Position memory);
    function market(Id id) external view returns (Market memory);
    function idToMarketParams(Id id) external view returns (MarketParams memory);
}

interface IMorphoFlashLoanCallback {
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external;
}

/// @dev Price of 1 unit of collateral in loan units, scaled by 1e36.
interface IOracle {
    function price() external view returns (uint256);
}

interface IIrm {
    function borrowRateView(MarketParams memory marketParams, Market memory market) external view returns (uint256);
}
