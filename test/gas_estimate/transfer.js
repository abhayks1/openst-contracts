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

/** @dev  This is the integration test to perform BT transfers using transfer
 *        rule contract.
 *
 *        Following steps are performed in the test :-
 *
 *        - EIP20TokenMock contract is deployed.
 *        - Organization contract is deployed and worker is set.
 *        - TokenRules contract is deployed.
 *         TransferRule contract is deployed and it is registered in TokenRules.
 *        - TokenHolder contract is deployed by providing the wallets and
 *           required confirmations.
 *        - Validation of deployed contract and its parameters are done.
 *           Below verifications are done:
 *            - TransferRule registration in TokenRules.
 *            - TokenRules address and EIP20TokenMock address in TH.
 *        - Using EIP20TokenMock's setBalance method,tokens are provided to TH.
 *        - Authorization and Verification of Ephemeral key is done.
 *        - We generate executable data for TransferRule contract's transferFrom
 *           method.
 *        - Relayer calls executeRule method of tokenholder contract.
 *           After it's execution below verifications are done:
 *            - RuleExecuted event.
 *            - tokenholder balance.
 *            - 'to' address balance.
 */
const EthUtils = require('ethereumjs-util'),
  testLibUtils = require('./../test_lib/utils'),
  AccountsProvider = testLibUtils.AccountProvider,
  Utils = require('./utils'),
  BN = require('bn.js');

contract('TokenHolder::executeRule', async (accounts) => {

  let accountProvider,
    tokenHolder,
    wallet1,
    eip20TokenMock,
    transferRule,
    tokenRules,
    ephemeralPrivateKey1,
    ephemeralKeyAddress1,
    keyData,
    totalBalance = 500;

  describe('ExecuteRule integration test', async () => {

    it('Validates the setup', async () => {

      accountProvider = new AccountsProvider(accounts);

      ({
        tokenHolder,
          wallet1,
          eip20TokenMock,
          transferRule,
          tokenRules,
      } = await Utils.setup(accountProvider));

      await eip20TokenMock.setBalance(tokenHolder.address, totalBalance);

      // Verify added rule
      assert.equal(
        (await tokenRules.rulesByAddress(transferRule.address)).exists,
        true,
      );

      assert.equal((await tokenHolder.tokenRules()), tokenRules.address);

      assert.equal((await tokenHolder.token()), eip20TokenMock.address);

    });

    it('Authorizes an ephemeral key', async () => {

      ephemeralPrivateKey1 = '0xa8225c01ceeaf01d7bc7c1b1b929037bd4050967c5730c0b854263121b8399f3';
      ephemeralKeyAddress1 = '0x62502C4DF73935D0D10054b0Fb8cC036534C6fb0';

      let currentBlockNumber = await web3.eth.getBlockNumber(),
        expirationHeight = currentBlockNumber + 50,
        spendingLimit = 200;

      await tokenHolder.submitAuthorizeSession(
        ephemeralKeyAddress1,
        spendingLimit,
        expirationHeight,
        { from: wallet1 },
      );

      keyData = await tokenHolder.ephemeralKeys(
        ephemeralKeyAddress1,
      );

      // Verify the authorization of key
      assert.equal(keyData.status, 1);

      assert.equal(keyData.expirationHeight, expirationHeight);

      assert.equal(keyData.spendingLimit, spendingLimit);

    });

    it('Verifies single transfer with a rule contract. ', async () => {

      let currentNonce = keyData.nonce,
        amountTransferred = 50;

      let nextAvailableNonce = currentNonce.toNumber() + 1;
      const to = accountProvider.get();

      const transferFromExecutable = await Utils.getTransferRulePayload(
        tokenHolder.address,
        to,
        new BN(amountTransferred),
      );

      const { rsv } = await Utils.getExecuteRuleExTxData(
        tokenHolder.address,
        transferRule.address,
        transferFromExecutable,
        new BN(nextAvailableNonce),
        ephemeralPrivateKey1,
      );

      let transactionResponse = await tokenHolder.executeRule(
        transferRule.address,
        transferFromExecutable,
        (currentNonce.toNumber() + 1),
        rsv.v,
        EthUtils.bufferToHex(rsv.r),
        EthUtils.bufferToHex(rsv.s),
      );

      assert.equal(transactionResponse.receipt.status, true);

      await testLibUtils.logResponse(transactionResponse,"ExecuteRule single transfer");

      // Verify 'to' address balance
      assert.equal(
        (await eip20TokenMock.balanceOf(to)), amountTransferred,
      );

      // Verify tokenholder balance
      assert.equal(
        (await eip20TokenMock.balanceOf(tokenHolder.address)),
        totalBalance - amountTransferred,
      );

    });

    it('Verifies tokenrule processTransfer execution for single transfer.', async () => {

      let keyData = await tokenHolder.ephemeralKeys(
        ephemeralKeyAddress1,
      );

      let currentNonce = keyData.nonce,
        amountTransferred = 50,
        nextAvailableNonce = currentNonce.toNumber() + 1;

      const to = accountProvider.get();

      const tokenRuleTransferFromExecutable = await Utils.generateTokenRuleTransferFromExecutable(
        to,
        new BN(amountTransferred),
      );

      const { rsv } = await Utils.getExecuteRuleExTxData(
        tokenHolder.address,
        tokenRules.address,
        tokenRuleTransferFromExecutable,
        new BN(nextAvailableNonce),
        ephemeralPrivateKey1,
      );

      let transactionResponse = await tokenHolder.executeRule(
        tokenRules.address,
        tokenRuleTransferFromExecutable,
        (currentNonce.toNumber() + 1),
        rsv.v,
        EthUtils.bufferToHex(rsv.r),
        EthUtils.bufferToHex(rsv.s),
      );

      await testLibUtils.logResponse(transactionResponse,"ExecuteRule single transfer - TokenRule processTransfer");

      let toBalance = (await eip20TokenMock.balanceOf(to));
      // Verify 'to' address balance
      assert.equal(
        toBalance.cmp(new BN(amountTransferred)),
        0,
      );

    });

    it('Total gas used', async () => {

      testLibUtils.printGasStatistics();

    });

  });

});
