// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import '../layerZeroInterfaces/ILayerZeroEndpoint.sol';

library LayerZeroEndpointStorage {
    struct LayerZeroSlot {
        uint256 startTokenId;
        uint maxTokenId;
        uint256 minGasToTransferAndStore;
        ILayerZeroEndpoint lzEndpoint;
    }

    bytes32 internal constant STORAGE_SLOT = keccak256('beachCrypto.omnichainDiamonds.storage.lZEndpoint');

    function layerZeroEndpointSlot() internal pure returns (LayerZeroSlot storage lzep) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            lzep.slot := slot
        }
    }
}
