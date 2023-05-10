// SPDX-License-Identifier: MIT

pragma solidity ^0.8.2;

import './IONFT721CoreUpgradeable.sol';
import {NonblockingLzAppUpgradeable} from './NonblockingLzAppUpgradeable.sol';

// NonblockingLzAppUpgradeable is causing the problem

abstract contract ONFT721UpgradeableInternal is IONFT721CoreUpgradeable, NonblockingLzAppUpgradeable {
    uint public constant NO_EXTRA_GAS = 0;
    uint public constant FUNCTION_TYPE_SEND = 1;
    bool public useCustomAdapterParams;
}
