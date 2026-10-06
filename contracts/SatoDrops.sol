// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract SatoDrops {
    uint256 public constant CREATION_FEE_BPS = 100; // 1%
    uint256 public constant CLAIM_FEE_BPS = 50; // 0.5%
    address public immutable feeRecipient;

    uint256 private unlocked = 1;

    struct Drop {
        address creator;
        address token;
        uint128 amountPerClaim;
        uint64 maxClaims;
        uint64 claimed;
        uint64 expiresAt;
        bool closed;
        string message;
    }

    uint256 public nextDropId;
    mapping(uint256 => Drop) public drops;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;
    mapping(uint256 => mapping(address => bool)) public allowedClaimants;
    mapping(uint256 => uint256) public allowedClaimantCount;

    event DropCreated(
        uint256 indexed dropId,
        address indexed creator,
        address indexed token,
        uint256 amountPerClaim,
        uint256 maxClaims,
        uint256 expiresAt,
        uint256 rewardTotal,
        uint256 creationFee,
        uint256 claimFeesReserved,
        bool walletSpecific,
        uint256 allowedWallets
    );
    event DropClaimed(uint256 indexed dropId, address indexed claimant, uint256 reward, uint256 claimFee);
    event DropClosed(uint256 indexed dropId, uint256 refunded);

    error InvalidToken();
    error InvalidAmount();
    error InvalidClaims();
    error InvalidWalletList();
    error NotAllowed();
    error Expired();
    error NotExpired();
    error Closed();
    error AlreadyClaimed();
    error SoldOut();
    error TransferFailed();
    error NotCreator();
    error Reentrant();

    modifier nonReentrant() {
        if (unlocked != 1) revert Reentrant();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(address _feeRecipient) {
        if (_feeRecipient == address(0)) revert InvalidToken();
        feeRecipient = _feeRecipient;
    }

    function createDrop(
        address token,
        uint128 amountPerClaim,
        uint64 maxClaims,
        uint64 expiresAt,
        bool walletSpecific,
        address[] calldata wallets,
        string calldata message
    ) external nonReentrant returns (uint256 dropId) {
        if (token == address(0)) revert InvalidToken();
        if (amountPerClaim == 0) revert InvalidAmount();
        if (maxClaims == 0) revert InvalidClaims();
        if (walletSpecific) {
            if (wallets.length == 0 || wallets.length > 100 || wallets.length != maxClaims) revert InvalidWalletList();
            for (uint256 i = 0; i < wallets.length; i++) {
                address wallet = wallets[i];
                if (wallet == address(0) || allowedClaimants[dropId][wallet]) revert InvalidWalletList();
                allowedClaimants[dropId][wallet] = true;
            }
            allowedClaimantCount[dropId] = wallets.length;
        } else if (wallets.length != 0) {
            revert InvalidWalletList();
        }
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert Expired();

        uint256 rewardTotal = uint256(amountPerClaim) * uint256(maxClaims);
        uint256 creationFee = (rewardTotal * CREATION_FEE_BPS) / 10_000;
        uint256 claimFeesReserved = (rewardTotal * CLAIM_FEE_BPS) / 10_000;

        _safeTransferFrom(token, msg.sender, feeRecipient, creationFee);
        _safeTransferFrom(token, msg.sender, address(this), rewardTotal + claimFeesReserved);

        dropId = nextDropId++;
        drops[dropId] = Drop({
            creator: msg.sender,
            token: token,
            amountPerClaim: amountPerClaim,
            maxClaims: maxClaims,
            claimed: 0,
            expiresAt: expiresAt,
            closed: false,
            message: message
        });

        emit DropCreated(
            dropId,
            msg.sender,
            token,
            amountPerClaim,
            maxClaims,
            expiresAt,
            rewardTotal,
            creationFee,
            claimFeesReserved,
            walletSpecific,
            wallets.length
        );
    }

    function claim(uint256 dropId) external nonReentrant {
        Drop storage drop = drops[dropId];
        if (drop.creator == address(0)) revert InvalidAmount();
        if (drop.closed) revert Closed();
        if (drop.expiresAt != 0 && block.timestamp >= drop.expiresAt) revert Expired();
        if (drop.claimed >= drop.maxClaims) revert SoldOut();
        if (hasClaimed[dropId][msg.sender]) revert AlreadyClaimed();
        if (allowedClaimantCount[dropId] != 0 && !allowedClaimants[dropId][msg.sender]) revert NotAllowed();

        uint256 reward = uint256(drop.amountPerClaim);
        uint256 claimFee = (reward * CLAIM_FEE_BPS) / 10_000;

        hasClaimed[dropId][msg.sender] = true;
        drop.claimed += 1;

        _safeTransfer(drop.token, msg.sender, reward);
        _safeTransfer(drop.token, feeRecipient, claimFee);

        emit DropClaimed(dropId, msg.sender, reward, claimFee);
    }

    function isWalletSpecific(uint256 dropId) external view returns (bool) {
        return allowedClaimantCount[dropId] != 0;
    }

    function isAllowedClaimant(uint256 dropId, address wallet) external view returns (bool) {
        return allowedClaimantCount[dropId] == 0 || allowedClaimants[dropId][wallet];
    }

    function closeExpiredDrop(uint256 dropId) external nonReentrant {
        Drop storage drop = drops[dropId];
        if (drop.creator == address(0)) revert InvalidAmount();
        if (msg.sender != drop.creator) revert NotCreator();
        if (drop.closed) revert Closed();
        if (drop.expiresAt == 0 || block.timestamp < drop.expiresAt) revert NotExpired();

        drop.closed = true;

        uint256 remainingClaims = uint256(drop.maxClaims) - uint256(drop.claimed);
        uint256 remainingRewards = uint256(drop.amountPerClaim) * remainingClaims;
        uint256 remainingClaimFees = (remainingRewards * CLAIM_FEE_BPS) / 10_000;
        uint256 refund = remainingRewards + remainingClaimFees;

        if (refund > 0) {
            _safeTransfer(drop.token, drop.creator, refund);
        }

        emit DropClosed(dropId, refund);
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }
}
