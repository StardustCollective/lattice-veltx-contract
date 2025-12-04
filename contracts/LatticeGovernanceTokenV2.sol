//SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ILatticeGovernanceTokenV1.sol";

contract LatticeGovernanceTokenV2 is ERC20, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 private ltxToken;
    ILatticeGovernanceTokenV1 private v1Contract;

    struct LockupData {
        uint256 amountLocked;
        uint256 amountReleased;
        uint256 fromTimestamp;
        uint256 toTimestamp;
        bool withdrawn;
        bool isVirtual; // If true, no LTX was locked (admin-created)
    }

    // Total LTX Locked (excludes virtual lockups)
    uint256 private _totalLtxLockedSupply;

    // user => Total LTX Locked (excludes virtual lockups)
    mapping(address => uint256) private _ltxLockedBalances;

    // lockupTime => tokenPercentageReleased
    mapping(uint256 => uint256) public lockupPoints;

    // user => slots.length
    mapping(address => uint256) public lockupSlots;

    // user => (slots[index] => lockupData)
    mapping(address => mapping(uint256 => LockupData)) public lockups;

    // Permanent flag to disable virtual lockup creation
    bool public virtualLockupsDisabled;

    event Locked(
        address indexed user,
        uint256 indexed lockupTime,
        uint256 indexed lockupSlot,
        uint256 amountLocked,
        uint256 amountReleased,
        uint256 timestamp
    );

    event Unlocked(
        address indexed user,
        uint256 indexed lockupSlot,
        uint256 amountUnlocked,
        uint256 amountReturned,
        uint256 timestamp
    );

    event VirtualLockupCreated(
        address indexed user,
        uint256 indexed lockupSlot,
        uint256 amountLocked,
        uint256 amountReleased,
        uint256 fromTimestamp,
        uint256 toTimestamp
    );

    event VirtualLockupUnlocked(
        address indexed user,
        uint256 indexed lockupSlot,
        uint256 veLTXBurned,
        uint256 timestamp
    );

    event LockupPointSet(
        uint256 indexed lockupTime,
        uint256 indexed tokenPercentageReleased
    );

    event VirtualLockupsDisabled(uint256 timestamp);

    event VirtualLockupRemoved(
        address indexed user,
        uint256 indexed lockupSlot,
        uint256 veLTXBurned,
        uint256 timestamp
    );

    constructor(
        IERC20 _ltxToken,
        ILatticeGovernanceTokenV1 _v1Contract
    ) ERC20("LatticeGovernanceToken", "veLTX") Ownable(msg.sender) {
        require(address(_v1Contract) != address(0), "veLTX: Invalid V1 contract address");
        ltxToken = _ltxToken;
        v1Contract = _v1Contract;
    }

    function transfer(address to, uint256 amount)
        public
        pure
        virtual
        override
        returns (bool)
    {
        revert("veLTX: The Lattice veLTX token is not transferable");
    }

    function allowance(address owner, address spender)
        public
        pure
        virtual
        override
        returns (uint256)
    {
        revert("veLTX: The Lattice veLTX token is not transferable");
    }

    function approve(address spender, uint256 amount)
        public
        pure
        virtual
        override
        returns (bool)
    {
        revert("veLTX: The Lattice veLTX token is not transferable");
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public pure virtual override returns (bool) {
        revert("veLTX: The Lattice veLTX token is not transferable");
    }

    function totalLtxLockedSupply() public view virtual returns (uint256) {
        return _totalLtxLockedSupply;
    }

    function ltxLockedBalanceOf(address account)
        public
        view
        virtual
        returns (uint256)
    {
        return _ltxLockedBalances[account];
    }

    function getUserLockups(address user, bool completed)
        public
        view
        virtual
        returns (LockupData[] memory)
    {
        uint256 _userSlots = lockupSlots[user];
        uint256 _selectedLockups = 0;

        for (uint256 i = 0; i < _userSlots; i++) {
            if (lockups[user][i].withdrawn == completed) {
                _selectedLockups++;
            }
        }

        LockupData[] memory _lockups = new LockupData[](_selectedLockups);
        uint256 _lockupsLength = 0;

        for (uint256 i = 0; i < _userSlots; i++) {
            if (lockups[user][i].withdrawn == completed) {
                _lockups[_lockupsLength] = lockups[user][i];
                _lockupsLength++;
            }
        }

        return _lockups;
    }

    function lock(uint256 _amount, uint256 _lockupTime)
        public
        nonReentrant
        whenNotPaused
    {
        require(
            lockupPoints[_lockupTime] != 0,
            "veLTX: Lockup point does not exist"
        );

        uint256 _lockupSlot = lockupSlots[msg.sender];
        lockupSlots[msg.sender] = _lockupSlot + 1;

        uint256 _amountReleased = _amount * lockupPoints[_lockupTime];

        lockups[msg.sender][_lockupSlot] = LockupData({
            amountLocked: _amount,
            amountReleased: _amountReleased,
            fromTimestamp: block.timestamp,
            toTimestamp: block.timestamp + _lockupTime,
            withdrawn: false,
            isVirtual: false
        });

        ltxToken.safeTransferFrom(msg.sender, address(this), _amount);

        _ltxLockedBalances[msg.sender] += _amount;
        _totalLtxLockedSupply += _amount;

        _mint(msg.sender, _amountReleased);

        emit Locked(
            msg.sender,
            _lockupTime,
            _lockupSlot,
            _amount,
            _amountReleased,
            block.timestamp
        );
    }

    function unlock(uint256 _lockupSlot) public nonReentrant whenNotPaused {
        require(
            lockupSlots[msg.sender] > _lockupSlot,
            "veLTX: Lockup slot not found"
        );

        LockupData storage _lockupData = lockups[msg.sender][_lockupSlot];

        require(!_lockupData.withdrawn, "veLTX: Lockup slot already withdrawn");
        require(
            _lockupData.toTimestamp <= block.timestamp,
            "veLTX: Lockup still in progress"
        );

        _lockupData.withdrawn = true;

        // Virtual lockups only burn veLTX (no LTX to return)
        if (_lockupData.isVirtual) {
            _burn(msg.sender, _lockupData.amountReleased);

            emit VirtualLockupUnlocked(
                msg.sender,
                _lockupSlot,
                _lockupData.amountReleased,
                block.timestamp
            );
            return;
        }

        // Regular lockups: burn veLTX and return LTX
        require(
            ltxToken.balanceOf(address(this)) >= _lockupData.amountLocked,
            "veLTX: Funds pool exceeds balance limit"
        );

        _burn(msg.sender, _lockupData.amountReleased);

        _totalLtxLockedSupply -= _lockupData.amountLocked;
        _ltxLockedBalances[msg.sender] -= _lockupData.amountLocked;

        ltxToken.safeTransfer(msg.sender, _lockupData.amountLocked);

        emit Unlocked(
            msg.sender,
            _lockupSlot,
            _lockupData.amountLocked,
            _lockupData.amountReleased,
            block.timestamp
        );
    }

    /**
     * @dev Admin creates a virtual lockup that mints veLTX without locking LTX
     * @param user The user to create the lockup for
     * @param amountLocked The amount that would have been locked (for display/accounting)
     * @param amountReleased The veLTX to mint
     * @param fromTimestamp When the lockup started
     * @param toTimestamp When the lockup ends
     */
    function adminCreateVirtualLockup(
        address user,
        uint256 amountLocked,
        uint256 amountReleased,
        uint256 fromTimestamp,
        uint256 toTimestamp
    ) public onlyOwner nonReentrant {
        require(!virtualLockupsDisabled, "veLTX: Virtual lockups are permanently disabled");
        require(user != address(0), "veLTX: Invalid user address");
        require(amountReleased > 0, "veLTX: Amount released must be greater than 0");
        require(toTimestamp > fromTimestamp, "veLTX: Invalid timestamp range");

        uint256 _lockupSlot = lockupSlots[user];
        lockupSlots[user] = _lockupSlot + 1;

        lockups[user][_lockupSlot] = LockupData({
            amountLocked: amountLocked,
            amountReleased: amountReleased,
            fromTimestamp: fromTimestamp,
            toTimestamp: toTimestamp,
            withdrawn: false,
            isVirtual: true
        });

        _mint(user, amountReleased);

        emit VirtualLockupCreated(
            user,
            _lockupSlot,
            amountLocked,
            amountReleased,
            fromTimestamp,
            toTimestamp
        );
    }

    /**
     * @dev Batch create virtual lockups for multiple users
     */
    function adminBatchCreateVirtualLockups(
        address[] calldata users,
        uint256[] calldata amountsLocked,
        uint256[] calldata amountsReleased,
        uint256[] calldata fromTimestamps,
        uint256[] calldata toTimestamps
    ) external onlyOwner {
        require(
            users.length == amountsLocked.length &&
            users.length == amountsReleased.length &&
            users.length == fromTimestamps.length &&
            users.length == toTimestamps.length,
            "veLTX: Array length mismatch"
        );

        for (uint256 i = 0; i < users.length; i++) {
            adminCreateVirtualLockup(
                users[i],
                amountsLocked[i],
                amountsReleased[i],
                fromTimestamps[i],
                toTimestamps[i]
            );
        }
    }

    function setLockupPoint(
        uint256 _lockupTime,
        uint256 _tokenPercentageReleased
    ) public onlyOwner {
        setLockupPoint(_lockupTime, _tokenPercentageReleased, false);
    }

    function setLockupPoint(
        uint256 _lockupTime,
        uint256 _tokenPercentageReleased,
        bool _force
    ) public onlyOwner {
        require(
            lockupPoints[_lockupTime] == 0 || _force,
            "veLTX: Lockup point is already set"
        );

        lockupPoints[_lockupTime] = _tokenPercentageReleased;

        emit LockupPointSet(_lockupTime, _tokenPercentageReleased);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    /**
     * @dev Permanently disables the creation of virtual lockups
     * This is irreversible - once disabled, virtual lockups cannot be created again
     * Useful after migration is complete to prevent future admin minting
     */
    function disableVirtualLockups() external onlyOwner {
        require(!virtualLockupsDisabled, "veLTX: Virtual lockups already disabled");
        virtualLockupsDisabled = true;
        emit VirtualLockupsDisabled(block.timestamp);
    }

    /**
     * @dev Admin removes a virtual lockup that was unlocked in V1
     * @param user The user address
     * @param lockupSlot The lockup slot to remove
     */
    function adminRemoveVirtualLockup(
        address user,
        uint256 lockupSlot
    ) public onlyOwner nonReentrant {
        require(user != address(0), "veLTX: Invalid user address");
        require(lockupSlots[user] > lockupSlot, "veLTX: Lockup slot not found");

        LockupData storage _lockupData = lockups[user][lockupSlot];

        require(_lockupData.isVirtual, "veLTX: Lockup is not virtual");
        require(!_lockupData.withdrawn, "veLTX: Lockup already withdrawn");

        // Verify that the lockup was unlocked in V1
        (, , , , bool v1Withdrawn) = v1Contract.lockups(user, lockupSlot);
        require(v1Withdrawn, "veLTX: Lockup not unlocked in V1");

        _lockupData.withdrawn = true;

        // Burn the veLTX tokens
        _burn(user, _lockupData.amountReleased);

        emit VirtualLockupRemoved(
            user,
            lockupSlot,
            _lockupData.amountReleased,
            block.timestamp
        );
    }

    /**
     * @dev Batch remove virtual lockups for multiple users
     */
    function adminBatchRemoveVirtualLockups(
        address[] calldata users,
        uint256[] calldata slots
    ) external onlyOwner {
        require(
            users.length == slots.length,
            "veLTX: Array length mismatch"
        );

        for (uint256 i = 0; i < users.length; i++) {
            adminRemoveVirtualLockup(users[i], slots[i]);
        }
    }
}
