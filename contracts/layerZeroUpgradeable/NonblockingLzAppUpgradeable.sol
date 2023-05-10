// SPDX-License-Identifier: MIT

pragma solidity ^0.8.2;

import '../libraries/LibDiamond.sol';
import '../layerZeroInterfaces/ILayerZeroReceiver.sol';
import '../layerZeroInterfaces/ILayerZeroUserApplicationConfig.sol';
import '../layerZeroInterfaces/ILayerZeroEndpoint.sol';
import {NonblockingLzAppStorage} from './NonblockingLzAppStorage.sol';
import 'hardhat/console.sol';

/*
 * the default LayerZero messaging behaviour is blocking, i.e. any failed message will block the channel
 * this abstract class try-catch all fail messages and store locally for future retry. hence, non-blocking
 * NOTE: if the srcAddress is not configured properly, it will still block the message pathway from (srcChainId, srcAddress)
 */
contract NonblockingLzAppUpgradeable is ILayerZeroReceiver, ILayerZeroUserApplicationConfig {
    event SetTrustedRemote(uint16 _srcChainId, bytes _srcAddress);

    event MessageFailed(uint16 _srcChainId, bytes _srcAddress, uint64 _nonce, bytes _payload);

    // LZAPP
    ILayerZeroEndpoint public lzEndpoint;

    // allow owner to set it multiple times.
    function setTrustedRemote(uint16 _srcChainId, bytes calldata _srcAddress) external {
        LibDiamond.enforceIsContractOwner();

        NonblockingLzAppStorage.nonblockingLzAppSlot().trustedRemoteLookup[_srcChainId] = _srcAddress;

        emit SetTrustedRemote(_srcChainId, _srcAddress);
    }

    // overriding the virtual function in LzReceiver
    function _blockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal virtual {
        // try-catch all errors/exceptions
        console.log('_blockingLzReceive called nonblockingLzReceive?..');
        try this.nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload) {
            // do nothing
        } catch {
            console.log('_blockingLzReceive called catch?..');
            // error / exception
            NonblockingLzAppStorage.nonblockingLzAppSlot().failedMessages[_srcChainId][_srcAddress][_nonce] = keccak256(
                _payload
            );
            emit MessageFailed(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }

    function nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) public virtual {
        // only internal transaction
        console.log('nonblockingLzReceive is called?..');
        require(msg.sender == address(this), 'NonblockingLzApp: caller must be LzApp');
        _nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
    }

    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal virtual {}

    function retryMessage(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) public payable virtual {
        // assert there is message to retry
        bytes32 payloadHash = NonblockingLzAppStorage.nonblockingLzAppSlot().failedMessages[_srcChainId][_srcAddress][
            _nonce
        ];
        require(payloadHash != bytes32(0), 'NonblockingLzApp: no stored message');
        require(keccak256(_payload) == payloadHash, 'NonblockingLzApp: invalid payload');
        // clear the stored message
        NonblockingLzAppStorage.nonblockingLzAppSlot().failedMessages[_srcChainId][_srcAddress][_nonce] = bytes32(0);
        // execute the message. revert if it fails again
        _nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
    }

    function lzReceive(
        uint16 _srcChainId,
        bytes calldata _srcAddress,
        uint64 _nonce,
        bytes calldata _payload
    ) external override {
        console.log('lzReceive gets called in NonblockingLzAppUpgradeable here...');
    }

    function setConfig(uint16 _version, uint16 _chainId, uint _configType, bytes calldata _config) external override {}

    function setSendVersion(uint16 _version) external override {}

    function setReceiveVersion(uint16 _version) external override {}

    function forceResumeReceive(uint16 _srcChainId, bytes calldata _srcAddress) external override {}
}
