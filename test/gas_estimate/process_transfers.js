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
 *         TransfersRule contract is deployed and it is registered in TokenRules.
 *        - TokenHolder contract is deployed by providing the wallets and
 *           required confirmations.
 *        - Validation of deployed contract and its parameters are done.
 *           Below verifications are done:
 *            - TransfersRule registration in TokenRules.
 *            - TokenRules address and EIP20TokenMock address in TH.
 *        - Using EIP20TokenMock's setBalance method,tokens are provided to TH.
 *        - Authorization and Verification of Ephemeral key is done.
 *        - We generate executable data for TransfersRule contract's transferFrom
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
    transfersRule,
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
        transfersRule,
        tokenRules,
      } = await Utils.setup(accountProvider));

      await eip20TokenMock.setBalance(tokenHolder.address, totalBalance);

      // Verify added rule
      assert.strictEqual(
        (await tokenRules.rulesByAddress(transfersRule.address)).exists,
        true,
      );

      assert.strictEqual((await tokenHolder.tokenRules()), tokenRules.address);

      assert.strictEqual((await tokenHolder.token()), eip20TokenMock.address);

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
      assert.strictEqual(keyData.status.cmp(new BN(1)), 0);

      assert.strictEqual(keyData.expirationHeight.cmp(new BN(expirationHeight)), 0);

      assert.strictEqual(keyData.spendingLimit.cmp(new BN(spendingLimit)), 0);

    });

    it('Verifies multiple transfers with a transfersRule contract.', async () => {

      let currentNonce = keyData.nonce,
        amountTransferred = new BN(50);

      let nextAvailableNonce = currentNonce.toNumber() + 1;
      const to1 = accountProvider.get(),
        to2 = accountProvider.get(),
        to3 = accountProvider.get();

      const transferFromExecutable = await Utils.getTransfersRulePayload(
        tokenHolder.address,
        [to1, to2, to3],
        [amountTransferred, amountTransferred, amountTransferred],
      );

      const { rsv } = await Utils.getExecuteRuleExTxData(
        tokenHolder.address,
        transfersRule.address,
        transferFromExecutable,
        new BN(nextAvailableNonce),
        ephemeralPrivateKey1,
      );

      let transactionResponse = await tokenHolder.executeRule(
        transfersRule.address,
        transferFromExecutable,
        (currentNonce.toNumber() + 1),
        rsv.v,
        EthUtils.bufferToHex(rsv.r),
        EthUtils.bufferToHex(rsv.s),
      );

      assert.strictEqual(transactionResponse.receipt.status, true);

      await testLibUtils.logResponse(
        transactionResponse,
        "ExecuteRule multiple transfers with transfersRule contract: "
      );

      let toBalance1 = (await eip20TokenMock.balanceOf(to1)),
        toBalance2 = (await eip20TokenMock.balanceOf(to2)),
        toBalance3 = (await eip20TokenMock.balanceOf(to3));

      // Verify 'to' address balance
      assert.strictEqual(toBalance1.cmp(amountTransferred), 0,);
      assert.strictEqual(toBalance2.cmp(amountTransferred), 0,);
      assert.strictEqual(toBalance3.cmp(amountTransferred), 0,);

    });

    it('Verifies tokenrule processTransfers execution for multiple transfers(3).', async () => {

      let keyData = await tokenHolder.ephemeralKeys(ephemeralKeyAddress1,);

      let currentNonce = keyData.nonce,
        amountTransferred = new BN(50),
        nextAvailableNonce = currentNonce.toNumber() + 1;

      const to1 = accountProvider.get(),
      to2 = accountProvider.get(),
      to3 = accountProvider.get();

      const tokenRuleTransferFromExecutable = await Utils.generateTokenRuleTransfersFromExecutable(
        [to1, to2, to3],
        [amountTransferred, amountTransferred, amountTransferred],
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

      assert.strictEqual(transactionResponse.receipt.status, true);

      await testLibUtils.logResponse(
        transactionResponse,
        "ExecuteRule multiple transfers with TokenRule processTransfers: "
      );

      let toBalance1 = (await eip20TokenMock.balanceOf(to1)),
        toBalance2 = (await eip20TokenMock.balanceOf(to2)),
        toBalance3 = (await eip20TokenMock.balanceOf(to2));

      // Verify 'to' address balance
      assert.strictEqual(toBalance1.cmp(amountTransferred), 0,);
      assert.strictEqual(toBalance2.cmp(amountTransferred), 0,);
      assert.strictEqual(toBalance3.cmp(amountTransferred), 0,);

    });

    it('Total gas used', async () => {

      testLibUtils.printGasStatistics();

    });

  });

});