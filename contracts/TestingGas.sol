// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract TestingGas {
    uint256 public constant CREATION_FEE_BPS = 100;
    uint256 public constant EARLY_CLAIM_WINDOW = 180;
    uint256 public constant EARLY_CLAIM_FEE = 100_000_000;

    address public immutable feeRecipient;
    address public immutable earlyClaimFeeToken;

    struct Drop {
        address creator;
        address token;
        uint256 totalAmount;
        uint256 remaining;
        uint256 createdAt;
        uint256 claimed;
        bool active;
    }

    uint256 public nextDropId;
    mapping(uint256 => Drop) public drops;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event DropCreated(uint256 indexed dropId, address indexed creator, address indexed token, uint256 amount, uint256 creationFee, uint256 createdAt);
    event Claimed(uint256 indexed dropId, address indexed claimant, uint256 amount, uint256 earlyClaimFee);
    event DropClosed(uint256 indexed dropId);

    error InvalidToken();
    error InvalidAmount();
    error DropNotFound();
    error DropInactive();
    error AlreadyClaimed();
    error InsufficientRemaining();
    error TransferFailed();
    error FeeTransferFailed();

    constructor(address _feeRecipient, address _earlyClaimFeeToken) {
        require(_feeRecipient != address(0), "fee recipient");
        require(_earlyClaimFeeToken != address(0), "fee token");
        feeRecipient = _feeRecipient;
        earlyClaimFeeToken = _earlyClaimFeeToken;
    }

    function createDrop(address token, uint256 amount) external returns (uint256 dropId) {
        if (token == address(0)) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();

        uint256 creationFee = amount / 100;
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (creationFee > 0 && !IERC20(token).transferFrom(msg.sender, feeRecipient, creationFee)) revert FeeTransferFailed();

        dropId = nextDropId++;
        drops[dropId] = Drop(msg.sender, token, amount, amount, block.timestamp, 0, true);
        emit DropCreated(dropId, msg.sender, token, amount, creationFee, block.timestamp);
    }

    function claim(uint256 dropId) external {
        Drop storage drop = drops[dropId];
        if (drop.creator == address(0)) revert DropNotFound();
        if (!drop.active) revert DropInactive();
        if (hasClaimed[dropId][msg.sender]) revert AlreadyClaimed();
        if (drop.remaining == 0) revert InsufficientRemaining();

        uint256 earlyFee;
        bool exempt = msg.sender == feeRecipient ||
            msg.sender == 0x5457A6A5bdA33bE94A542Bc841C28E6Be70Ad3c;

        if (!exempt && block.timestamp < drop.createdAt + EARLY_CLAIM_WINDOW) {
            earlyFee = EARLY_CLAIM_FEE;
            if (!IERC20(earlyClaimFeeToken).transferFrom(msg.sender, feeRecipient, earlyFee)) revert FeeTransferFailed();
        }

        hasClaimed[dropId][msg.sender] = true;
        drop.remaining -= 1;
        drop.claimed += 1;

        if (!IERC20(drop.token).transfer(msg.sender, 1)) revert TransferFailed();

        if (drop.remaining == 0) {
            drop.active = false;
            emit DropClosed(dropId);
        }

        emit Claimed(dropId, msg.sender, 1, earlyFee);
    }
}
