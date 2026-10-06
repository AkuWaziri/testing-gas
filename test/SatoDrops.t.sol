// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SatoDrops.sol";

contract MockERC20 {
    string public name = "Mock USD";
    string public symbol = "MUSD";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SatoDropsTest is Test {
    SatoDrops internal drops;
    MockERC20 internal token;
    address internal creator = address(0xA11CE);
    address internal feeRecipient = address(0xFEE);
    address internal claimant = address(0xB0B);

    function setUp() public {
        drops = new SatoDrops(feeRecipient);
        token = new MockERC20();
        token.mint(creator, 1_000_000_000);
        vm.prank(creator);
        token.approve(address(drops), type(uint256).max);
    }

    function testCreateChargesOnePercentAndReservesHalfPercentClaimFees() public {
        vm.prank(creator);
        uint256 id = drops.createDrop(address(token), 5_000_000, 10, 0, false, new address[](0), "test");

        assertEq(id, 0);
        assertEq(token.balanceOf(feeRecipient), 500_000);
        assertEq(token.balanceOf(address(drops)), 50_500_000);

        (
            address dropCreator,
            address dropToken,
            uint128 amountPerClaim,
            uint64 maxClaims,
            uint64 claimed,
            uint64 expiresAt,
            bool closed,
            string memory message
        ) = drops.drops(id);

        assertEq(dropCreator, creator);
        assertEq(dropToken, address(token));
        assertEq(amountPerClaim, 5_000_000);
        assertEq(maxClaims, 10);
        assertEq(claimed, 0);
        assertEq(expiresAt, 0);
        assertFalse(closed);
        assertEq(message, "test");
    }

    function testClaimPaysFullRewardAndHalfPercentFee() public {
        vm.prank(creator);
        uint256 id = drops.createDrop(address(token), 5_000_000, 10, 0, false, new address[](0), "test");

        vm.prank(claimant);
        drops.claim(id);

        assertEq(token.balanceOf(claimant), 5_000_000);
        assertEq(token.balanceOf(feeRecipient), 525_000);
        assertEq(token.balanceOf(address(drops)), 45_475_000);
        assertTrue(drops.hasClaimed(id, claimant));
    }

    function testCannotClaimSameDropTwice() public {
        vm.prank(creator);
        uint256 id = drops.createDrop(address(token), 1_000_000, 2, 0, false, new address[](0), "test");

        vm.prank(claimant);
        drops.claim(id);

        vm.expectRevert(SatoDrops.AlreadyClaimed.selector);
        vm.prank(claimant);
        drops.claim(id);
    }

    function testExpiredDropRefundsRemainingRewardsAndReservedClaimFees() public {
        vm.prank(creator);
        uint256 id = drops.createDrop(address(token), 5_000_000, 10, uint64(block.timestamp + 1 hours), false, new address[](0), "refund");

        uint256 creatorBefore = token.balanceOf(creator);
        vm.warp(block.timestamp + 1 hours);

        vm.prank(creator);
        drops.closeExpiredDrop(id);

        uint256 expectedRefund = 50_000_000 + 250_000;
        assertEq(token.balanceOf(creator), creatorBefore + expectedRefund);
        assertEq(token.balanceOf(address(drops)), 0);
    }

    function testExpiredDropAfterOneClaimRefundsOnlyRemainingBalance() public {
        vm.prank(creator);
        uint256 id = drops.createDrop(address(token), 5_000_000, 10, uint64(block.timestamp + 1 hours), false, new address[](0), "refund");

        vm.prank(claimant);
        drops.claim(id);

        uint256 creatorBefore = token.balanceOf(creator);
        vm.warp(block.timestamp + 1 hours);

        vm.prank(creator);
        drops.closeExpiredDrop(id);

        uint256 expectedRefund = 45_000_000 + 225_000;
        assertEq(token.balanceOf(creator), creatorBefore + expectedRefund);
        assertEq(token.balanceOf(address(drops)), 0);
    }
}
