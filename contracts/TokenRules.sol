pragma solidity ^0.4.23;

// Copyright 2018 OpenST Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import "./GlobalConstraintInterface.sol";
import "./SafeMath.sol";
import "./EIP20TokenInterface.sol";
import "./Organized.sol";


/**
 * @notice Register of whitelisted rules that are allowed to initiate transfers
 *         from a token holder accounts.
 *
 * @dev TokenHolder.executeRule() function will execute any rule that are
 *      signed by an authorized and non-expired ephemeral key.
 *      However, only the rules, that are registered in TokenRules
 *      can initiate transfers of token from TokenHolder to other beneficiaries.
 *      TokenHolder is going to allow TokenRules as a spender before
 *      execution of the rule (amount is limited by spendingLimit registered
 *      during an authorizaiton of an ephemeral key.). TokenHolder will
 *      clear this allowance after execution.
 *      Before execution of transfers from TokenHolder, TokenRules will
 *      check that all global constraints are satisified.
 *      During a execution, rule can call TokenRules.executeTransfers()
 *      function only once. This allows global constraints to be checked
 *      on complete list of transfers.
 */
contract TokenRules is Organized {

     /* Usings */

    using SafeMath for uint256;


    /* Events */

    event RuleRegistered(
        string _ruleName,
        address _ruleAddress
    );

    event GlobalConstraintAdded(address _globalConstraintAddress);

    event GlobalConstraintRemoved(address _globalConstraintAddress);


    /* Structs */

    struct TokenRule {
        string ruleName;
        address ruleAddress;
        string ruleAbi;
    }

    /**
     * RuleIndex struct is going to be used in 'rulesByAddress' and
     * 'rulesByNameHash' mappings for pointing to the index with 'rules' array.
     * Simple usage of uint256 in those mappings does not work, because
     * for non existing rule name and address it defaults to 0 index,
     * which is obviously wrong. Before accessing 'rules' array by index
     * one should check 'exists' field of the struct.
     */
    struct RuleIndex {
        uint256 index;
        bool exists;
    }

    /* Storage */

    /** Contains all registered rule in the order of registration. */
    TokenRule[] public rules;

    /** Mapping from a rule address to the index in the `rules` array. */
    mapping (address => RuleIndex) public rulesByAddress;

    /** Mapping from a rule name hash to the index in the `rules` array. */
    mapping (bytes32 => RuleIndex) public rulesByNameHash;

    /** Contains a list of all registered global constraints. */
    address[] public globalConstraints;

    EIP20TokenInterface public token;

    /**
     * TokenHolder contract before a rule execution will set the flag
     * on (true) for itself. TokenRules.executeTransfers will set the flag to
     * off (false) for _from (TokenHolder) after execution. This will restrict
     * a rule to make a call to TokenRules.executeTransfers only *once*.
     */
    mapping (address => bool) public allowedTransfers;


    /* Modifiers */


    modifier onlyRule {
        require(
            rulesByAddress[msg.sender].exists,
            "Only registered rule is allowed to call."
        );
        _;
    }


    /* Special Functions */

    /**
     * @dev Function requires:
     *          - Token address is not null.
     */
    constructor(
        OrganizationIsWorkerInterface _organization,
        EIP20TokenInterface _token
    )
        Organized(_organization)
        public
    {
        require(_token != address(0), "Token address is null.");

        token = _token;
    }


    /* External Functions */

    /**
     * @dev Function requires:
     *          - Only worker can call.
     *          - Rule name is not empty.
     *          - Rule with the specified name does not exist.
     *          - Rule address is not null.
     *          - Rule with the specified address does not exist.
     *          - Rule abi is not empty.
     *
     * @param _ruleName The name of a rule to register.
     * @param _ruleAddress The address of a rule to register.
     * @param _ruleAbi The abi of the rule to register.
     */
    function registerRule(
        string _ruleName,
        address _ruleAddress,
        string _ruleAbi
    )
        external
        onlyWorker
    {
        require(bytes(_ruleName).length != 0, "Rule name is empty.");
        require(_ruleAddress != address(0), "Rule address is null.");
        require(bytes(_ruleAbi).length != 0, "Rule ABI is empty.");

        bytes32 ruleNameHash = keccak256(abi.encodePacked(_ruleName));

        require(
            !rulesByNameHash[ruleNameHash].exists,
            "Rule with the specified name already exists."
        );
        require(
            !rulesByAddress[_ruleAddress].exists,
            "Rule with the specified address already exists."
        );

        TokenRule memory rule = TokenRule({
            ruleName: _ruleName,
            ruleAddress: _ruleAddress,
            ruleAbi: _ruleAbi
        });

        RuleIndex memory ruleIndex = RuleIndex({
            index: rules.length,
            exists: true
        });

        rulesByAddress[_ruleAddress] = ruleIndex;
        rulesByNameHash[ruleNameHash] = ruleIndex;
        rules.push(rule);

        emit RuleRegistered(_ruleName, _ruleAddress);
    }

    /** @dev See documentation for allowedTransfers storage variable. */
    function allowTransfers()
        external
    {
        allowedTransfers[msg.sender] = true;
    }

    /** @dev See documentation for allowedTransfers storage variable. */
    function disallowTransfers()
        external
    {
        allowedTransfers[msg.sender] = false;
    }

    /**
     * @dev Transfers from the specified account to all beneficiary
     *      accounts corresponding amounts.
     *      Function requires:
     *          - Only registered rule can call.
     *          - An account from which (_from) transfer will be done should
     *            allow this transfer by calling to TokenRules.allowTransfers().
     *            TokenRules will set this allowance back, hence, only
     *            one call is allowed per execution session.
     *          - _transfersTo and _transfersAmount arrays length should match.
     *          - All globally registered constraints should satisfy before
     *            execution.
     *
     * @param _from An address from which transfer is done.
     * @param _transfersTo List of addresses to transfer.
     * @param _transfersAmount List of amounts to transfer.
     */
    function executeTransfers(
        address _from,
        address[] _transfersTo,
        uint256[] _transfersAmount
    )
        external
        onlyRule
    {
        require(
            allowedTransfers[_from],
            "Transfers from the address are not allowed."
        );

        require(
            _transfersTo.length == _transfersAmount.length,
            "'to' and 'amount' transfer arrays' lengths are not equal."
        );

        require(
            checkGlobalConstraints(_from, _transfersTo, _transfersAmount),
            "Constraints not fullfilled."
        );

        for(uint256 i = 0; i < _transfersTo.length; ++i) {
            token.transferFrom(
                _from,
                _transfersTo[i],
                _transfersAmount[i]
            );
        }

        allowedTransfers[_from] = false;
    }

    /**
     * @dev Transfer from the msg.sender to beneficiary account.
     *
     * @param _transferTo Addresses of to transfer.
     * @param _transferAmount Amount to transfer.
     */
    function processTransfer(
        address _transferTo,
        uint256 _transferAmount
    )
        external
    {
        require(
            allowedTransfers[msg.sender],
            "Transfers from the address are not allowed."
        );

        token.transferFrom(
            msg.sender,
            _transferTo,
            _transferAmount
        );
    }

    /**
     * @dev Transfer from the msg.sender to beneficiary accounts.
     *
     * @param _transfersTo Addresses of to transfer.
     * @param _transfersAmount Amounts to transfer.
     */
    function processTransfers(
        address[] _transfersTo,
        uint256[] _transfersAmount
    )
        external
    {
        require(
            allowedTransfers[msg.sender],
            "Transfers from the address are not allowed."
        );

        require(
            _transfersTo.length == _transfersAmount.length,
            "'to' and 'amount' transfer arrays' lengths are not equal."
        );

        for(uint256 i = 0; i < _transfersTo.length; ++i) {
            token.transferFrom(
                msg.sender,
                _transfersTo[i],
                _transfersAmount[i]
            );
        }
    }

    /**
     * @notice Registers a constraint to check globally before
     *         executing transfers.
     *
     * @dev Function requires:
     *          - Only worker can call.
     *          - Constraint address is not null.
     *          - Constraint is not registered.
     */
    function addGlobalConstraint(
        address _globalConstraintAddress
    )
        external
        onlyWorker
    {
        require(
            _globalConstraintAddress != address(0),
            "Constraint to add is null."
        );

        uint256 index = findGlobalConstraintIndex(_globalConstraintAddress);

        require(
            index == globalConstraints.length,
            "Constraint to add already exists."
        );

        globalConstraints.push(_globalConstraintAddress);

        emit GlobalConstraintAdded(_globalConstraintAddress);
    }

    /**
     * @dev Function requires:
     *          - Only worker can call.
     *          - Constraint exists.
     */
    function removeGlobalConstraint(
        address _globalConstraintAddress
    )
        external
        onlyWorker
    {
        uint256 index = findGlobalConstraintIndex(_globalConstraintAddress);

        require(
            index != globalConstraints.length,
            "Constraint to remove does not exist."
        );

        removeGlobalConstraintByIndex(index);

        emit GlobalConstraintRemoved(_globalConstraintAddress);
    }


    /* Public Functions */

    function globalConstraintCount()
        public
        view
        returns (uint256)
    {
        return globalConstraints.length;
    }

    /**
     * @dev Function requires:
     *          - _transfersTo and _transfersAmount arrays length should match.
     *
     * @return Returns true, if all registered global constraints
     *         are satisfied, otherwise false.
     */
    function checkGlobalConstraints(
        address _from,
        address[] _transfersTo,
        uint256[] _transfersAmount
    )
        public
        view
        returns (bool _passed)
    {
        require(
            _transfersTo.length == _transfersAmount.length,
            "'to' and 'amount' transfer arrays' lengths are not equal."
        );

        _passed = true;

        for(uint256 i = 0; i < globalConstraints.length && _passed; ++i) {
            _passed = GlobalConstraintInterface(globalConstraints[i]).check(
                _from,
                _transfersTo,
                _transfersAmount
            );
        }
    }


    /* Private Functions */

    /**
     * @dev Finds index of constraint.
     *
     * @param _constraint Constraint to find in constraints array.
     *
     * @return index_ Returns index of the constraint if exists,
     *                otherwise returns constraints.length.
     */
    function findGlobalConstraintIndex(address _constraint)
        private
        view
        returns (uint256 index_)
    {
        index_ = 0;
        while(
            index_ < globalConstraints.length &&
            globalConstraints[index_] != _constraint
        )
        {
            ++index_;
        }
    }

    function removeGlobalConstraintByIndex(uint256 _index)
        private
    {
        require(_index < globalConstraints.length, "Index is out of range.");

        uint256 lastElementIndex = globalConstraints.length - 1;
        globalConstraints[_index] = globalConstraints[lastElementIndex];
        --globalConstraints.length;
    }
}
