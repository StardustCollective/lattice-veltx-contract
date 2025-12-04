//SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ILatticeGovernanceTokenV1
 * @dev Interface for interacting with V1 contract to verify lockup states
 */
interface ILatticeGovernanceTokenV1 {
  struct LockupData {
    uint256 amountLocked;
    uint256 amountReleased;
    uint256 fromTimestamp;
    uint256 toTimestamp;
    bool withdrawn;
  }

  /**
   * @notice Get the number of lockup slots for a user
   * @param user The user address
   * @return The number of lockup slots
   */
  function lockupSlots(address user) external view returns (uint256);

  /**
   * @notice Get lockup data for a specific user and slot
   * @param user The user address
   * @param slot The lockup slot index
   * @return amountLocked The amount of LTX locked
   * @return amountReleased The amount of veLTX released
   * @return fromTimestamp The start timestamp of the lockup
   * @return toTimestamp The end timestamp of the lockup
   * @return withdrawn Whether the lockup has been withdrawn
   */
  function lockups(
    address user,
    uint256 slot
  ) external view returns (
    uint256 amountLocked,
    uint256 amountReleased,
    uint256 fromTimestamp,
    uint256 toTimestamp,
    bool withdrawn
  );
}
