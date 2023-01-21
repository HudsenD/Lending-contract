// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

error Lending__TokenNotApproved();
error Lending__TransferFailed();
error Lending__InsufficentTokensInPlatform();
error Lending__AmountIsZero();

contract Lending is Ownable, ReentrancyGuard {
    constructor() {}

    // 5% liquidation reward
    uint256 private constant LIQUIDATION_REWARD = 5;
    // LTV of 80% or greater, user can be liquidated, 1/0.8 = 1.25
    uint256 private constant LIQUIDATION_POINT = 125e16;
    // To prevent instant liquidation, LTV must be 75% or less at borrow or withdraw time
    uint256 private constant MIN_USABLE_SAFETY_FACTOR = 133e16;

    // token -> priceFeed
    mapping(address => address) s_tokenToPriceFeed;

    // user -> token -> deposit
    mapping(address => mapping(address => uint256)) s_userToTokenDeposits;
    // user -> token -> borrow
    mapping(address => mapping(address => uint256)) s_userToTokenBorrows;

    address[] public s_approvedTokenList;

    event Deposit(address indexed user, address indexed token, uint256 indexed amount);
    event Borrow(address indexed user, address indexed token, uint256 indexed amount);
    event TokenApproved(address indexed token, address indexed priceFeed);
    event Repay(address indexed user, address indexed token, uint256 indexed amount);
    event Liquidated(
        address indexed user,
        address indexed repayToken,
        address indexed rewardToken,
        uint256 halfDebtInEth,
        address liquidator
    );

    modifier isApprovedToken(address token) {
        if (s_tokenToPriceFeed[token] == address(0)) {
            revert Lending__TokenNotApproved();
        }
        _;
    }

    modifier isNotZero(uint256 amount) {
        if (amount == 0) {
            revert Lending__AmountIsZero();
        }
        _;
    }

    function deposit(address token, uint256 amount) external nonReentrant isApprovedToken(token) {
        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        if (!success) {
            revert Lending__TransferFailed();
        }
        s_userToTokenDeposits[msg.sender][token] += amount;
        emit Deposit(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant isApprovedToken(token) {
        s_userToTokenDeposits[msg.sender][token] -= amount;
        bool success = IERC20(token).transfer(msg.sender, amount);
        if (!success) {
            revert Lending__TransferFailed();
        }

        require(safetyFactor(msg.sender) >= MIN_USABLE_SAFETY_FACTOR, "You will get Liquidated!");
    }

    function borrow(address token, uint256 amount) external nonReentrant isApprovedToken(token) {
        if (IERC20(token).balanceOf(address(this)) < amount) {
            revert Lending__InsufficentTokensInPlatform();
        }
        s_userToTokenBorrows[token][msg.sender] += amount;
        emit Borrow(msg.sender, token, amount);
        bool success = IERC20(token).transfer(msg.sender, amount);
        if (!success) {
            revert Lending__TransferFailed();
        }

        require(safetyFactor(msg.sender) >= MIN_USABLE_SAFETY_FACTOR, "Deposit more value!");
    }

    function liquidate(address user, address repayToken, address rewardToken) external nonReentrant {
        require(safetyFactor(user) < LIQUIDATION_POINT, "User Can't Be liquidated");
        uint256 halfDebt = s_userToTokenBorrows[user][repayToken] / 2;
        uint256 halfDebtInEth = getEthValue(repayToken, halfDebt);
        require(halfDebtInEth > 0, "Choose a different repayToken!");
        uint256 rewardAmountInEth = (halfDebtInEth * LIQUIDATION_REWARD) / 100;
        uint256 totalRewardAmountInRewardToken = getTokenValueFromEth(rewardToken, rewardAmountInEth + halfDebtInEth);
        emit Liquidated(user, repayToken, rewardToken, halfDebtInEth, msg.sender);
        _repay(user, repayToken, halfDebt);
        bool success = IERC20(rewardToken).transfer(msg.sender, totalRewardAmountInRewardToken);
        if (!success) {
            revert Lending__TransferFailed();
        }
    }

    function repay(address token, uint256 amount) external isApprovedToken(token) {
        _repay(msg.sender, token, amount);
        emit Repay(msg.sender, token, amount);
    }

    function _repay(address user, address token, uint256 amount) private {
        s_userToTokenBorrows[user][token] -= amount;
        bool success = IERC20(token).transferFrom(user, address(this), amount);
        if (!success) {
            revert Lending__TransferFailed();
        }
    }

    function safetyFactor(address user) public view returns (uint256) {
        uint256 borrowValueInEth = getUserBorrowedValue(user);
        uint256 collateralValueInEth = getUserCollateralValue(user);

        if (borrowValueInEth == 0) {
            return 100e18;
        }
        return ((collateralValueInEth * 1e18) / borrowValueInEth);
    }

    function getUserCollateralValue(address user) public view returns (uint256) {
        uint256 totalCollateralInEth = 0;
        for (uint256 i = 0; i < s_approvedTokenList.length; i++) {
            address token = s_approvedTokenList[i];
            uint256 amount = s_userToTokenDeposits[user][token];
            totalCollateralInEth += getEthValue(token, amount);
        }
        return totalCollateralInEth;
    }

    function getUserBorrowedValue(address user) public view returns (uint256) {
        uint256 totalBorrowedInEth = 0;
        for (uint256 i = 0; i < s_approvedTokenList.length; i++) {
            address token = s_approvedTokenList[i];
            uint256 amount = s_userToTokenDeposits[user][token];
            totalBorrowedInEth += getEthValue(token, amount);
        }
        return totalBorrowedInEth;
    }

    function getEthValue(address token, uint256 amount) public view returns (uint256) {
        AggregatorV3Interface priceFeed = AggregatorV3Interface(s_tokenToPriceFeed[token]);
        (, int256 price, , , ) = priceFeed.latestRoundData();
        return (uint256(price) * amount) / 1e18;
    }

    function getTokenValueFromEth(address token, uint256 amount) public view returns (uint256) {
        AggregatorV3Interface priceFeed = AggregatorV3Interface(s_tokenToPriceFeed[token]);
        (, int256 price, , , ) = priceFeed.latestRoundData();
        return ((amount * 1e18) / uint256(price));
    }

    function setApprovedToken(address token, address priceFeed) external onlyOwner {
        require(s_tokenToPriceFeed[token] == address(0), "Token already approved!");
        s_tokenToPriceFeed[token] = priceFeed;
        s_approvedTokenList.push(token);

        emit TokenApproved(token, priceFeed);
    }
}
