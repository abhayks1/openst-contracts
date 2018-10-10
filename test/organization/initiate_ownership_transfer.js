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


const utils = require('../test_lib/utils.js'),
  { AccountProvider } = require('../test_lib/utils.js'),
  { Event } = require('../test_lib/event_decoder');

const Organization = artifacts.require('Organization');

contract('Organization::initiateOwnershipTransfer', async () => {

  contract('Negative Tests', async (accounts) => {
    const accountProvider = new AccountProvider(accounts),
      owner = accountProvider.get(),
      proposedOwner = accountProvider.get();
    let organization = null;

    beforeEach(async function () {
      organization = await Organization.new();
    });

    it('Reverts when caller is not owner.', async () => {

      await utils.expectRevert(
        organization.initiateOwnershipTransfer(
          proposedOwner,
          { from: accountProvider.get() },
        ),
        'Should revert as caller is not owner.',
        'Only owner is allowed to call.',
      );
    });

    it('Reverts when proposed owner is same as owner.', async () => {

      await utils.expectRevert(
        organization.initiateOwnershipTransfer(
          owner,
          { from: owner },
        ),
        'Should revert as owner is proposing himself for ownership transfer.',
        'proposedOwner address can\'t be owner address.',
      );

    });

  });

  contract('Storage Tests', async (accounts) => {
    const accountProvider = new AccountProvider(accounts),
      owner = accountProvider.get(),
      proposedOwner = accountProvider.get();
    let organization = null;

    beforeEach(async function () {
      organization = await Organization.new();
    });

    it('Should pass when correct proposed owner is passed.', async () => {
      assert.ok(
        await organization.initiateOwnershipTransfer(
          proposedOwner,
          { from: owner },
        )
      );

      assert.strictEqual(await organization.proposedOwner.call(), proposedOwner);
    });

    it('Should pass when proposed address is 0x.', async () => {
      assert.ok(
        await organization.initiateOwnershipTransfer(
          utils.NULL_ADDRESS,
          { from: owner },
        )
      );
      assert.strictEqual(await organization.proposedOwner.call(), utils.NULL_ADDRESS);
    });

  });

  contract('Event Tests', async (accounts) => {
    const accountProvider = new AccountProvider(accounts),
      owner = accountProvider.get(),
      proposedOwner = accountProvider.get();
    let organization = null;

    beforeEach(async function () {
      organization = await Organization.new();
    });

    it('Verifies emitting of OwnershipTransferInitiated event.', async () => {
      const transactionReceipt = await organization.initiateOwnershipTransfer(
          proposedOwner,
          { from: owner },
        );

      const events = Event.decodeTransactionResponse(
        transactionReceipt,
      );

      assert.strictEqual(
        events.length,
        1,
        'OwnershipTransferInitiated event should be emitted.',
      );

      // The emitted event should be 'OwnershipTransferInitiated'.
      Event.assertEqual(events[0], {
        name: 'OwnershipTransferInitiated',
        args: {
          _proposedOwner: proposedOwner,
        },
      });

    });

  });

});