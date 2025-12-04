//SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./LatticeGovernanceTokenV2.sol";

/**
 * @title LatticeGovernanceTokenDeployer
 * @dev Deploys LatticeGovernanceTokenV2 using CREATE2 for deterministic addresses
 */
contract LatticeGovernanceTokenDeployer {
    event ContractDeployed(
        address indexed deployedAddress,
        address indexed owner,
        address indexed ltxToken,
        bytes32 salt
    );

    /**
     * @notice Computes deployment address for a given salt
     * @param ltxToken LTX token address
     * @param salt Value to be used for deployment
     * @return predicted address
     */
    function computeAddress(
        address ltxToken,
        bytes32 salt
    ) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(
                    abi.encodePacked(
                        type(LatticeGovernanceTokenV2).creationCode,
                        abi.encode(ltxToken)
                    )
                )
            )
        );
        return address(uint160(uint256(hash)));
    }

    /**
     * @notice Checks if a contract has been deployed at the computed address
     * @param ltxToken The LTX token address
     * @param salt The salt used for deployment
     * @return True if contract is deployed at the address
     */
    function isDeployed(
        address ltxToken,
        bytes32 salt
    ) public view returns (bool) {
        address predicted = computeAddress(ltxToken, salt);
        uint256 size;
        assembly {
            size := extcodesize(predicted)
        }
        return size > 0;
    }

    /**
     * @notice Deploys a new contract with deterministic address using CREATE2
     * @param ltxToken LTX token address
     * @param salt Value used to compute deployment address
     * @return deployed contract (ownership transferred to caller)
     */
    function deployDeterministic(
        address ltxToken,
        bytes32 salt
    ) public returns (LatticeGovernanceTokenV2 deployed) {
        deployed = new LatticeGovernanceTokenV2{salt: salt}(IERC20(ltxToken));

        // Transfer ownership to msg.sender
        deployed.transferOwnership(msg.sender);

        emit ContractDeployed(address(deployed), msg.sender, ltxToken, salt);
    }
}
