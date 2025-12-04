import { type HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { expect } from 'chai';
import dayjs from 'dayjs';
import { ContractTransactionResponse, TransactionReceipt } from 'ethers';
import hre from 'hardhat';

import type { LatticeGovernanceTokenV1 } from '../types/ethers-contracts/LatticeGovernanceTokenV1.ts';
import type { LatticeGovernanceTokenV2 } from '../types/ethers-contracts/LatticeGovernanceTokenV2.ts';
import type { TestLatticeToken } from '../types/ethers-contracts/TestLatticeToken.ts';
import { configureDayJsLib } from '../utils/index.ts';

configureDayJsLib();

const LOCKUP_POINTS = [
  [dayjs.duration({ months: 6 }), 0.25],
  [dayjs.duration({ months: 12 }), 0.5],
  [dayjs.duration({ months: 24 }), 0.75],
  [dayjs.duration({ months: 36 }), 1],
] as const;

const TOKEN_EXPONENT_DIFF = 10;

const { ethers, networkHelpers } = await hre.network.connect();

const deployTokens = async () => {
  const [ownerAccount, userAccountA, userAccountB] = await ethers.getSigners();

  const LatticeTokenFactory =
    await ethers.getContractFactory('TestLatticeToken');
  const ltxToken = await LatticeTokenFactory.connect(ownerAccount).deploy();

  // Deploy V1 contract for testing V2's removal functionality
  const LatticeGovernanceTokenV1Factory = await ethers.getContractFactory(
    'LatticeGovernanceTokenV1',
  );
  const veltxTokenV1 = await LatticeGovernanceTokenV1Factory.connect(
    ownerAccount,
  ).deploy(await ltxToken.getAddress());

  const LatticeGovernanceTokenFactory = await ethers.getContractFactory(
    'LatticeGovernanceTokenV2',
  );
  const veltxToken = await LatticeGovernanceTokenFactory.connect(
    ownerAccount,
  ).deploy(await ltxToken.getAddress(), await veltxTokenV1.getAddress());

  const exponentDiff =
    (await veltxToken.decimals()) - (await ltxToken.decimals());

  for (const [lockupTime, tokenPercentageReleased] of LOCKUP_POINTS) {
    const tx = await veltxToken
      .connect(ownerAccount)
      [
        'setLockupPoint(uint256,uint256)'
      ](lockupTime.as('seconds'), tokenPercentageReleased * 10 ** Number(exponentDiff));

    await tx.wait(1);
  }

  // Set up V1 with same lockup points for testing
  for (const [lockupTime, tokenPercentageReleased] of LOCKUP_POINTS) {
    const tx = await veltxTokenV1
      .connect(ownerAccount)
      [
        'setLockupPoint(uint256,uint256)'
      ](lockupTime.as('seconds'), tokenPercentageReleased * 10 ** Number(exponentDiff));

    await tx.wait(1);
  }

  return {
    ltxToken,
    veltxToken,
    veltxTokenV1,
    ownerAccount,
    userAccountA,
    userAccountB,
  };
};

const provideBalance = async (
  ltxToken: TestLatticeToken,
  balances: [string, number][],
) => {
  const decimals = await ltxToken.decimals();

  for (const [account, balance] of balances) {
    await ltxToken.mint(account, ethers.parseUnits(String(balance), decimals));
  }
};

const executeLock = async (
  context: {
    veltxToken: LatticeGovernanceTokenV2 | LatticeGovernanceTokenV1;
    ltxToken: TestLatticeToken;
    account: HardhatEthersSigner;
  },
  ltxLocked: number,
  lockTimeMonths: number,
  waitConfirmation = true,
  providedBalance = ltxLocked,
  providedAllowance = ltxLocked,
) => {
  const { veltxToken, ltxToken, account } = context;

  const decimalsLtx = await ltxToken.decimals();
  const decimalsVeltx = await veltxToken.decimals();

  await provideBalance(ltxToken, [[account.address, providedBalance]]);

  await ltxToken
    .connect(account)
    .approve(
      await veltxToken.getAddress(),
      ethers.parseUnits(String(providedAllowance), decimalsLtx),
    );

  const lockupSlot = Number(await veltxToken.lockupSlots(account.address));

  const lockTrxPromise = veltxToken
    .connect(account)
    .lock(
      ethers.parseUnits(String(ltxLocked), decimalsLtx),
      dayjs.duration({ months: lockTimeMonths }).as('seconds'),
    );

  let lockTrx: ContractTransactionResponse | null = null;
  let lockTrxReceipt: TransactionReceipt | null = null;

  if (waitConfirmation) {
    lockTrx = await lockTrxPromise;
    lockTrxReceipt = await lockTrx.wait(1);
  }

  const lockupData = waitConfirmation
    ? await veltxToken.lockups(account.address, lockupSlot)
    : null;

  return {
    decimalsLtx,
    decimalsVeltx,
    lockTrxPromise,
    lockupSlot,
    lockTrx,
    lockTrxReceipt,
    lockupData,
  };
};

const executeUnlock = async (
  context: {
    veltxToken: LatticeGovernanceTokenV2 | LatticeGovernanceTokenV1;
    ltxToken: TestLatticeToken;
    account: HardhatEthersSigner;
  },
  lockupSlot: number,
  monthsAhead: number,
  waitConfirmation = true,
) => {
  const { veltxToken, ltxToken, account } = context;

  const decimalsLtx = await ltxToken.decimals();
  const decimalsVeltx = await veltxToken.decimals();

  await networkHelpers.time.increase(
    dayjs.duration({ months: monthsAhead }).as('seconds'),
  );

  const unlockTrxPromise = veltxToken.connect(account).unlock(lockupSlot);

  let unlockTrx: ContractTransactionResponse | null = null;
  let unlockTrxReceipt: TransactionReceipt | null = null;

  if (waitConfirmation) {
    unlockTrx = await unlockTrxPromise;
    unlockTrxReceipt = await unlockTrx.wait(1);
  }

  return {
    decimalsLtx,
    decimalsVeltx,
    unlockTrxPromise,
    unlockTrx,
    unlockTrxReceipt,
  };
};

describe('LatticeGovernanceTokenV2', function () {
  describe('Deploys', async () => {
    it('Deploys with right owner', async () => {
      const { veltxToken, ownerAccount } =
        await networkHelpers.loadFixture(deployTokens);

      expect(await veltxToken.owner()).to.equal(ownerAccount.address);
    });

    it('Deploys not paused', async () => {
      const { veltxToken } = await networkHelpers.loadFixture(deployTokens);

      expect(await veltxToken.paused()).to.equal(false);
    });

    it('Deploys veLTX With 18 decimals', async () => {
      const { veltxToken } = await networkHelpers.loadFixture(deployTokens);

      expect(await veltxToken.decimals()).to.equal(18);
    });

    it('Deploys LTX With 8 decimals', async () => {
      const { ltxToken } = await networkHelpers.loadFixture(deployTokens);

      expect(await ltxToken.decimals()).to.equal(8);
    });

    it('Deploys with right lockup times', async () => {
      const { veltxToken } = await networkHelpers.loadFixture(deployTokens);

      expect(
        Number(
          await veltxToken.lockupPoints(
            dayjs.duration({ months: 6 }).as('seconds'),
          ),
        ),
      ).to.equal(0.25 * 10 ** TOKEN_EXPONENT_DIFF);

      expect(
        Number(
          await veltxToken.lockupPoints(
            dayjs.duration({ months: 12 }).as('seconds'),
          ),
        ),
      ).to.equal(0.5 * 10 ** TOKEN_EXPONENT_DIFF);

      expect(
        Number(
          await veltxToken.lockupPoints(
            dayjs.duration({ months: 24 }).as('seconds'),
          ),
        ),
      ).to.equal(0.75 * 10 ** TOKEN_EXPONENT_DIFF);

      expect(
        Number(
          await veltxToken.lockupPoints(
            dayjs.duration({ months: 36 }).as('seconds'),
          ),
        ),
      ).to.equal(1 * 10 ** TOKEN_EXPONENT_DIFF);
    });
  });

  describe('Locks', async () => {
    describe('Basic', async () => {
      const testBasicLockup = (
        ltxLocked: number,
        lockTimeMonths: number,
        veltxReleased: number,
      ) => {
        it(`Locks ${ltxLocked} LTX for ${lockTimeMonths} months to receive ${veltxReleased} veLTX`, async () => {
          const context = await networkHelpers.loadFixture(deployTokens);
          const { veltxToken, ltxToken, userAccountA } = context;
          const { lockTrxReceipt, decimalsLtx, decimalsVeltx } =
            await executeLock(
              { veltxToken, ltxToken, account: userAccountA },
              ltxLocked,
              lockTimeMonths,
            );

          const lockEvent = lockTrxReceipt?.logs
            ?.map((log) => {
              try {
                return veltxToken.interface.parseLog({
                  topics: [...log.topics],
                  data: log.data,
                });
              } catch {
                return null;
              }
            })
            .find((parsed) => parsed?.name === 'Locked');

          if (!lockEvent) {
            throw new Error('Locked event not found');
          }

          expect(lockEvent.args.user).to.equal(userAccountA.address);
          expect(lockEvent.args.lockupTime).to.equal(
            dayjs.duration({ months: lockTimeMonths }).as('seconds'),
          );
          expect(Number(lockEvent.args.lockupSlot)).to.equal(0);
          expect(lockEvent.args.amountLocked).to.equal(
            ethers.parseUnits(String(ltxLocked), decimalsLtx),
          );
          expect(lockEvent.args.amountReleased).to.equal(
            ethers.parseUnits(String(veltxReleased), decimalsVeltx),
          );

          expect(
            parseFloat(
              ethers.formatUnits(
                await veltxToken.balanceOf(userAccountA.address),
                decimalsVeltx,
              ),
            ),
          ).to.equal(veltxReleased);
        });
      };

      testBasicLockup(1000, 6, 250);
      testBasicLockup(1000, 12, 500);
      testBasicLockup(1000, 24, 750);
      testBasicLockup(1000, 36, 1000);

      testBasicLockup(7457, 6, 7457 * 0.25);
      testBasicLockup(4620, 12, 4620 * 0.5);
      testBasicLockup(3259, 24, 3259 * 0.75);
      testBasicLockup(6654, 36, 6654);

      testBasicLockup(8019.7973, 6, 8019.7973 * 0.25);
      testBasicLockup(3399.9228, 12, 3399.9228 * 0.5);
      testBasicLockup(1333.9405, 24, 1333.9405 * 0.75);
      testBasicLockup(2526.6499, 36, 2526.6499);
    });

    describe('Locks multiple times', async () => {
      const testMultipleLockup = (
        lockTimes: number,
        ltxLocked: number,
        lockTimeMonths: number,
        veltxReleased: number,
      ) => {
        const executeLockAndTest = async (
          context: Awaited<ReturnType<typeof deployTokens>>,
          lockupSlot: number,
          totalVeltxReleased: number,
        ) => {
          const { veltxToken, ltxToken, userAccountA } = context;
          const { lockTrxReceipt, decimalsLtx, decimalsVeltx } =
            await executeLock(
              { veltxToken, ltxToken, account: userAccountA },
              ltxLocked,
              lockTimeMonths,
            );

          const lockEvent = lockTrxReceipt?.logs
            ?.map((log) => {
              try {
                return veltxToken.interface.parseLog({
                  topics: [...log.topics],
                  data: log.data,
                });
              } catch {
                return null;
              }
            })
            .find((parsed) => parsed?.name === 'Locked');

          if (!lockEvent) {
            throw new Error('Locked event not found');
          }

          expect(lockEvent.args.user).to.equal(userAccountA.address);
          expect(lockEvent.args.lockupTime).to.equal(
            dayjs.duration({ months: lockTimeMonths }).as('seconds'),
          );
          expect(Number(lockEvent.args.lockupSlot)).to.equal(lockupSlot);
          expect(lockEvent.args.amountLocked).to.equal(
            ethers.parseUnits(String(ltxLocked), decimalsLtx),
          );
          expect(lockEvent.args.amountReleased).to.equal(
            ethers.parseUnits(String(veltxReleased), decimalsVeltx),
          );

          const deltaDiff = Math.abs(
            parseFloat(
              ethers.formatUnits(
                await veltxToken.balanceOf(userAccountA.address),
                decimalsVeltx,
              ),
            ) - totalVeltxReleased,
          );

          expect(deltaDiff).lessThan(0.0001);
        };

        it(`Locks ${lockTimes} times for ${lockTimeMonths} months`, async () => {
          const context = await networkHelpers.loadFixture(deployTokens);

          for (let i = 0; i < lockTimes; i++) {
            await executeLockAndTest(context, i, (i + 1) * veltxReleased);
          }

          expect(
            Number(
              await context.veltxToken.lockupSlots(
                context.userAccountA.address,
              ),
            ),
          ).to.equal(lockTimes);
        });
      };

      testMultipleLockup(4, 1000, 6, 250);
      testMultipleLockup(9, 1000, 12, 500);
      testMultipleLockup(1, 1000, 24, 750);
      testMultipleLockup(6, 1000, 36, 1000);

      testMultipleLockup(1, 7457, 6, 7457 * 0.25);
      testMultipleLockup(9, 4620, 12, 4620 * 0.5);
      testMultipleLockup(10, 3259, 24, 3259 * 0.75);
      testMultipleLockup(6, 6654, 36, 6654);

      testMultipleLockup(9, 8019.7973, 6, 8019.7973 * 0.25);
      testMultipleLockup(2, 3399.9228, 12, 3399.9228 * 0.5);
      testMultipleLockup(3, 1333.9405, 24, 1333.9405 * 0.75);
      testMultipleLockup(4, 2526.6499, 36, 2526.6499);
    });

    describe('Reverts', async () => {
      it('Reverts on not existent lockup point', async () => {
        const { veltxToken, ltxToken, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        const { lockTrxPromise } = await executeLock(
          { veltxToken, ltxToken, account: userAccountA },
          2500,
          32,
          false,
        );

        await expect(lockTrxPromise).to.be.revertedWith(
          'veLTX: Lockup point does not exist',
        );
      });

      it('Reverts on not enough balance', async () => {
        const context = await networkHelpers.loadFixture(deployTokens);
        const { ltxToken, veltxToken, userAccountA } = context;

        const { lockTrxPromise } = await executeLock(
          { veltxToken, ltxToken, account: userAccountA },
          2500,
          36,
          false,
          100,
          2500,
        );

        await expect(lockTrxPromise).to.be.revertedWithCustomError(
          veltxToken,
          'ERC20InsufficientBalance',
        );
      });

      it('Reverts on not enough allowance', async () => {
        const context = await networkHelpers.loadFixture(deployTokens);
        const { veltxToken, ltxToken, userAccountA } = context;

        const { lockTrxPromise } = await executeLock(
          { veltxToken, ltxToken, account: userAccountA },
          2500,
          36,
          false,
          2500,
          0,
        );

        await expect(lockTrxPromise).to.be.revertedWithCustomError(
          veltxToken,
          'ERC20InsufficientAllowance',
        );
      });
    });
  });

  describe('Unlocks', async () => {
    describe('Basic', async () => {
      const testBasicLockupAndUnlock = (
        ltxLocked: number,
        lockTimeMonths: number,
        veltxReleased: number,
      ) => {
        it(`Locks & Unlocks ${ltxLocked} LTX for ${lockTimeMonths} months to return ${veltxReleased} veLTX`, async () => {
          const context = await networkHelpers.loadFixture(deployTokens);
          const { ltxToken, veltxToken, userAccountA } = context;
          const { decimalsLtx, decimalsVeltx, lockupSlot } = await executeLock(
            { veltxToken, ltxToken, account: userAccountA },
            ltxLocked,
            lockTimeMonths,
          );

          const { unlockTrxReceipt } = await executeUnlock(
            { veltxToken, ltxToken, account: userAccountA },
            lockupSlot,
            lockTimeMonths,
          );

          const unlockEvent = unlockTrxReceipt?.logs
            ?.map((log) => {
              try {
                return veltxToken.interface.parseLog({
                  topics: [...log.topics],
                  data: log.data,
                });
              } catch {
                return null;
              }
            })
            .find((parsed) => parsed?.name === 'Unlocked');

          if (!unlockEvent) {
            throw new Error('Unlocked event not found');
          }

          expect(unlockEvent.args.user).to.equal(userAccountA.address);
          expect(Number(unlockEvent.args.lockupSlot)).to.equal(lockupSlot);
          expect(Number(unlockEvent.args.lockupSlot)).to.equal(0);
          expect(unlockEvent.args.amountUnlocked).to.equal(
            ethers.parseUnits(String(ltxLocked), decimalsLtx),
          );
          expect(unlockEvent.args.amountReturned).to.equal(
            ethers.parseUnits(String(veltxReleased), decimalsVeltx),
          );

          expect(
            parseFloat(
              ethers.formatUnits(
                await veltxToken.balanceOf(userAccountA.address),
                decimalsVeltx,
              ),
            ),
          ).to.equal(0);

          expect(
            parseFloat(
              ethers.formatUnits(
                await ltxToken.balanceOf(userAccountA.address),
                decimalsLtx,
              ),
            ),
          ).to.equal(ltxLocked);
        });
      };

      testBasicLockupAndUnlock(1000, 6, 250);
      testBasicLockupAndUnlock(1000, 12, 500);
      testBasicLockupAndUnlock(1000, 24, 750);
      testBasicLockupAndUnlock(1000, 36, 1000);

      testBasicLockupAndUnlock(7457, 6, 7457 * 0.25);
      testBasicLockupAndUnlock(4620, 12, 4620 * 0.5);
      testBasicLockupAndUnlock(3259, 24, 3259 * 0.75);
      testBasicLockupAndUnlock(6654, 36, 6654);

      testBasicLockupAndUnlock(8019.7973, 6, 8019.7973 * 0.25);
      testBasicLockupAndUnlock(3399.9228, 12, 3399.9228 * 0.5);
      testBasicLockupAndUnlock(1333.9405, 24, 1333.9405 * 0.75);
      testBasicLockupAndUnlock(2526.6499, 36, 2526.6499);
    });
  });

  describe('Virtual Lockups', async () => {
    describe('Admin Create Virtual Lockup', async () => {
      it('Should create virtual lockup and mint veLTX without locking LTX', async () => {
        const { veltxToken, ownerAccount, userAccountA, ltxToken } =
          await networkHelpers.loadFixture(deployTokens);

        const amountLocked = ethers.parseUnits('1000', 8);
        const amountReleased = ethers.parseUnits('1000', 18);
        const fromTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const toTimestamp =
          fromTimestamp + BigInt(dayjs.duration({ months: 36 }).as('seconds'));

        const initialBalance = await veltxToken.balanceOf(userAccountA.address);
        const initialLtxBalance = await ltxToken.balanceOf(
          await veltxToken.getAddress(),
        );

        const tx = await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            amountLocked,
            amountReleased,
            fromTimestamp,
            toTimestamp,
          );

        const receipt = await tx.wait();

        // Check event was emitted
        const event = receipt?.logs
          ?.map((log) => {
            try {
              return veltxToken.interface.parseLog({
                topics: [...log.topics],
                data: log.data,
              });
            } catch {
              return null;
            }
          })
          .find((parsed) => parsed?.name === 'VirtualLockupCreated');

        expect(event).to.not.be.undefined;
        expect(event?.args?.user).to.equal(userAccountA.address);
        expect(Number(event?.args?.lockupSlot)).to.equal(0);
        expect(event?.args?.amountLocked).to.equal(amountLocked);
        expect(event?.args?.amountReleased).to.equal(amountReleased);

        // Check veLTX was minted
        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(
          initialBalance + amountReleased,
        );

        // Check no LTX was locked
        expect(
          await ltxToken.balanceOf(await veltxToken.getAddress()),
        ).to.equal(initialLtxBalance);

        // Check lockup data
        const lockup = await veltxToken.lockups(userAccountA.address, 0);
        expect(lockup.amountLocked).to.equal(amountLocked);
        expect(lockup.amountReleased).to.equal(amountReleased);
        expect(lockup.isVirtual).to.equal(true);
        expect(lockup.withdrawn).to.equal(false);
      });

      it('Should increment lockup slot correctly', async () => {
        const { veltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        const amountLocked = ethers.parseUnits('1000', 8);
        const amountReleased = ethers.parseUnits('1000', 18);
        const fromTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const toTimestamp =
          fromTimestamp + BigInt(dayjs.duration({ months: 36 }).as('seconds'));

        expect(
          Number(await veltxToken.lockupSlots(userAccountA.address)),
        ).to.equal(0);

        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            amountLocked,
            amountReleased,
            fromTimestamp,
            toTimestamp,
          );

        expect(
          Number(await veltxToken.lockupSlots(userAccountA.address)),
        ).to.equal(1);

        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            amountLocked,
            amountReleased,
            fromTimestamp,
            toTimestamp,
          );

        expect(
          Number(await veltxToken.lockupSlots(userAccountA.address)),
        ).to.equal(2);
      });

      it('Should revert if not owner', async () => {
        const { veltxToken, userAccountA, userAccountB } =
          await networkHelpers.loadFixture(deployTokens);

        const amountLocked = ethers.parseUnits('1000', 8);
        const amountReleased = ethers.parseUnits('1000', 18);
        const fromTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const toTimestamp =
          fromTimestamp + BigInt(dayjs.duration({ months: 36 }).as('seconds'));

        await expect(
          veltxToken
            .connect(userAccountA)
            .adminCreateVirtualLockup(
              userAccountB.address,
              amountLocked,
              amountReleased,
              fromTimestamp,
              toTimestamp,
            ),
        ).to.be.revertedWithCustomError(
          veltxToken,
          'OwnableUnauthorizedAccount',
        );
      });

      it('Should revert if virtual lockups are disabled', async () => {
        const { veltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        const amountLocked = ethers.parseUnits('1000', 8);
        const amountReleased = ethers.parseUnits('1000', 18);
        const fromTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const toTimestamp =
          fromTimestamp + BigInt(dayjs.duration({ months: 36 }).as('seconds'));

        // Disable virtual lockups
        await veltxToken.connect(ownerAccount).disableVirtualLockups();

        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminCreateVirtualLockup(
              userAccountA.address,
              amountLocked,
              amountReleased,
              fromTimestamp,
              toTimestamp,
            ),
        ).to.be.revertedWith('veLTX: Virtual lockups are permanently disabled');
      });

      it('Should revert with invalid user address', async () => {
        const { veltxToken, ownerAccount } =
          await networkHelpers.loadFixture(deployTokens);

        const amountLocked = ethers.parseUnits('1000', 8);
        const amountReleased = ethers.parseUnits('1000', 18);
        const fromTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const toTimestamp =
          fromTimestamp + BigInt(dayjs.duration({ months: 36 }).as('seconds'));

        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminCreateVirtualLockup(
              ethers.ZeroAddress,
              amountLocked,
              amountReleased,
              fromTimestamp,
              toTimestamp,
            ),
        ).to.be.revertedWith('veLTX: Invalid user address');
      });

      it('Should revert with zero amount released', async () => {
        const { veltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        const amountLocked = ethers.parseUnits('1000', 8);
        const amountReleased = 0n;
        const fromTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const toTimestamp =
          fromTimestamp + BigInt(dayjs.duration({ months: 36 }).as('seconds'));

        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminCreateVirtualLockup(
              userAccountA.address,
              amountLocked,
              amountReleased,
              fromTimestamp,
              toTimestamp,
            ),
        ).to.be.revertedWith('veLTX: Amount released must be greater than 0');
      });

      it('Should revert with invalid timestamp range', async () => {
        const { veltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        const amountLocked = ethers.parseUnits('1000', 8);
        const amountReleased = ethers.parseUnits('1000', 18);
        const fromTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const toTimestamp = fromTimestamp - 1n; // Invalid: toTimestamp < fromTimestamp

        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminCreateVirtualLockup(
              userAccountA.address,
              amountLocked,
              amountReleased,
              fromTimestamp,
              toTimestamp,
            ),
        ).to.be.revertedWith('veLTX: Invalid timestamp range');
      });
    });

    describe('Batch Create Virtual Lockups', async () => {
      it('Should create multiple virtual lockups', async () => {
        const { veltxToken, ownerAccount, userAccountA, userAccountB } =
          await networkHelpers.loadFixture(deployTokens);

        const users = [userAccountA.address, userAccountB.address];
        const amountsLocked = [
          ethers.parseUnits('1000', 8),
          ethers.parseUnits('2000', 8),
        ];
        const amountsReleased = [
          ethers.parseUnits('1000', 18),
          ethers.parseUnits('2000', 18),
        ];
        const fromTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const fromTimestamps = [fromTimestamp, fromTimestamp];
        const toTimestamps = [
          fromTimestamp + BigInt(dayjs.duration({ months: 36 }).as('seconds')),
          fromTimestamp + BigInt(dayjs.duration({ months: 24 }).as('seconds')),
        ];

        await veltxToken
          .connect(ownerAccount)
          .adminBatchCreateVirtualLockups(
            users,
            amountsLocked,
            amountsReleased,
            fromTimestamps,
            toTimestamps,
          );

        // Check user A
        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(
          amountsReleased[0],
        );
        expect(
          Number(await veltxToken.lockupSlots(userAccountA.address)),
        ).to.equal(1);

        // Check user B
        expect(await veltxToken.balanceOf(userAccountB.address)).to.equal(
          amountsReleased[1],
        );
        expect(
          Number(await veltxToken.lockupSlots(userAccountB.address)),
        ).to.equal(1);
      });

      it('Should revert with array length mismatch', async () => {
        const { veltxToken, ownerAccount, userAccountA, userAccountB } =
          await networkHelpers.loadFixture(deployTokens);

        const users = [userAccountA.address, userAccountB.address];
        const amountsLocked = [ethers.parseUnits('1000', 8)]; // Mismatch
        const amountsReleased = [
          ethers.parseUnits('1000', 18),
          ethers.parseUnits('2000', 18),
        ];
        const fromTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const fromTimestamps = [fromTimestamp, fromTimestamp];
        const toTimestamps = [
          fromTimestamp + BigInt(dayjs.duration({ months: 36 }).as('seconds')),
          fromTimestamp + BigInt(dayjs.duration({ months: 24 }).as('seconds')),
        ];

        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminBatchCreateVirtualLockups(
              users,
              amountsLocked,
              amountsReleased,
              fromTimestamps,
              toTimestamps,
            ),
        ).to.be.revertedWith('veLTX: Array length mismatch');
      });
    });

    describe('Virtual Lockup Unlocking', async () => {
      it('Should unlock virtual lockup and burn veLTX without returning LTX', async () => {
        const { veltxToken, ownerAccount, userAccountA, ltxToken } =
          await networkHelpers.loadFixture(deployTokens);

        const amountLocked = ethers.parseUnits('1000', 8);
        const amountReleased = ethers.parseUnits('1000', 18);
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        const lockDuration = BigInt(
          dayjs.duration({ months: 36 }).as('seconds'),
        );
        const fromTimestamp = currentTime;
        const toTimestamp = currentTime + lockDuration;

        // Create virtual lockup
        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            amountLocked,
            amountReleased,
            fromTimestamp,
            toTimestamp,
          );

        // Fast forward time
        await networkHelpers.time.increase(lockDuration);

        const initialLtxBalance = await ltxToken.balanceOf(
          userAccountA.address,
        );

        // Unlock virtual lockup
        const tx = await veltxToken.connect(userAccountA).unlock(0);
        const receipt = await tx.wait();

        // Check event was emitted
        const event = receipt?.logs
          ?.map((log) => {
            try {
              return veltxToken.interface.parseLog({
                topics: [...log.topics],
                data: log.data,
              });
            } catch {
              return null;
            }
          })
          .find((parsed) => parsed?.name === 'VirtualLockupUnlocked');

        expect(event).to.not.be.undefined;
        expect(event?.args?.user).to.equal(userAccountA.address);
        expect(Number(event?.args?.lockupSlot)).to.equal(0);
        expect(event?.args?.veLTXBurned).to.equal(amountReleased);

        // Check veLTX was burned
        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(0n);

        // Check no LTX was returned
        expect(await ltxToken.balanceOf(userAccountA.address)).to.equal(
          initialLtxBalance,
        );

        // Check lockup was marked as withdrawn
        const lockup = await veltxToken.lockups(userAccountA.address, 0);
        expect(lockup.withdrawn).to.equal(true);
      });

      it('Should handle mixed virtual and regular lockups', async () => {
        const context = await networkHelpers.loadFixture(deployTokens);
        const { veltxToken, ownerAccount, userAccountA, ltxToken } = context;

        // Create a regular lockup
        await executeLock(
          { veltxToken, ltxToken, account: userAccountA },
          1000,
          36,
        );

        // Create a virtual lockup
        const amountLocked = ethers.parseUnits('1000', 8);
        const amountReleased = ethers.parseUnits('1000', 18);
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        const lockDuration = BigInt(
          dayjs.duration({ months: 36 }).as('seconds'),
        );
        const fromTimestamp = currentTime;
        const toTimestamp = currentTime + lockDuration;

        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            amountLocked,
            amountReleased,
            fromTimestamp,
            toTimestamp,
          );

        // User should have 2000 veLTX (1000 from regular + 1000 from virtual)
        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(
          ethers.parseUnits('2000', 18),
        );

        // Fast forward time
        await networkHelpers.time.increase(lockDuration);

        const initialLtxBalance = await ltxToken.balanceOf(
          userAccountA.address,
        );

        // Unlock regular lockup (slot 0) - should return LTX
        await veltxToken.connect(userAccountA).unlock(0);
        expect(await ltxToken.balanceOf(userAccountA.address)).to.equal(
          initialLtxBalance + ethers.parseUnits('1000', 8),
        );

        // Unlock virtual lockup (slot 1) - should NOT return LTX
        const ltxBalanceBeforeVirtual = await ltxToken.balanceOf(
          userAccountA.address,
        );
        await veltxToken.connect(userAccountA).unlock(1);
        expect(await ltxToken.balanceOf(userAccountA.address)).to.equal(
          ltxBalanceBeforeVirtual,
        );

        // All veLTX should be burned
        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(0n);
      });
    });

    describe('Disable Virtual Lockups', async () => {
      it('Should permanently disable virtual lockups', async () => {
        const { veltxToken, ownerAccount } =
          await networkHelpers.loadFixture(deployTokens);

        expect(await veltxToken.virtualLockupsDisabled()).to.equal(false);

        const tx = await veltxToken
          .connect(ownerAccount)
          .disableVirtualLockups();
        const receipt = await tx.wait();

        // Check event was emitted
        const event = receipt?.logs
          ?.map((log) => {
            try {
              return veltxToken.interface.parseLog({
                topics: [...log.topics],
                data: log.data,
              });
            } catch {
              return null;
            }
          })
          .find((parsed) => parsed?.name === 'VirtualLockupsDisabled');

        expect(event).to.not.be.undefined;
        expect(await veltxToken.virtualLockupsDisabled()).to.equal(true);
      });

      it('Should revert if already disabled', async () => {
        const { veltxToken, ownerAccount } =
          await networkHelpers.loadFixture(deployTokens);

        await veltxToken.connect(ownerAccount).disableVirtualLockups();

        await expect(
          veltxToken.connect(ownerAccount).disableVirtualLockups(),
        ).to.be.revertedWith('veLTX: Virtual lockups already disabled');
      });

      it('Should revert if not owner', async () => {
        const { veltxToken, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        await expect(
          veltxToken.connect(userAccountA).disableVirtualLockups(),
        ).to.be.revertedWithCustomError(
          veltxToken,
          'OwnableUnauthorizedAccount',
        );
      });

      it('Should not affect existing virtual lockups', async () => {
        const { veltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        const amountLocked = ethers.parseUnits('1000', 8);
        const amountReleased = ethers.parseUnits('1000', 18);
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        const lockDuration = BigInt(
          dayjs.duration({ months: 36 }).as('seconds'),
        );
        const fromTimestamp = currentTime;
        const toTimestamp = currentTime + lockDuration;

        // Create virtual lockup
        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            amountLocked,
            amountReleased,
            fromTimestamp,
            toTimestamp,
          );

        // Disable virtual lockups
        await veltxToken.connect(ownerAccount).disableVirtualLockups();

        // Fast forward time
        await networkHelpers.time.increase(lockDuration);

        // Should still be able to unlock existing virtual lockup
        await expect(
          veltxToken.connect(userAccountA).unlock(0),
        ).to.not.be.revert(ethers);

        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(0n);
      });
    });

    describe('Edge Cases', async () => {
      it('Should handle zero amountLocked in virtual lockup', async () => {
        const { veltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        const amountLocked = 0n; // Zero LTX locked
        const amountReleased = ethers.parseUnits('1000', 18);
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        const lockDuration = BigInt(
          dayjs.duration({ months: 36 }).as('seconds'),
        );
        const fromTimestamp = currentTime;
        const toTimestamp = currentTime + lockDuration;

        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            amountLocked,
            amountReleased,
            fromTimestamp,
            toTimestamp,
          );

        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(
          amountReleased,
        );

        const lockup = await veltxToken.lockups(userAccountA.address, 0);
        expect(lockup.amountLocked).to.equal(0n);
        expect(lockup.isVirtual).to.equal(true);
      });

      it('Should handle large batch of virtual lockups', async () => {
        const { veltxToken, ownerAccount } =
          await networkHelpers.loadFixture(deployTokens);

        const batchSize = 50;
        const signers = await ethers.getSigners();
        const users = signers.slice(0, batchSize).map((s) => s.address);
        const amountsLocked = Array(batchSize).fill(
          ethers.parseUnits('100', 8),
        );
        const amountsReleased = Array(batchSize).fill(
          ethers.parseUnits('100', 18),
        );
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        const fromTimestamps = Array(batchSize).fill(currentTime);
        const toTimestamps = Array(batchSize).fill(
          currentTime + BigInt(dayjs.duration({ months: 36 }).as('seconds')),
        );

        await veltxToken
          .connect(ownerAccount)
          .adminBatchCreateVirtualLockups(
            users,
            amountsLocked,
            amountsReleased,
            fromTimestamps,
            toTimestamps,
          );

        // Check all users received veLTX
        for (const user of users) {
          expect(await veltxToken.balanceOf(user)).to.equal(
            ethers.parseUnits('100', 18),
          );
        }
      });

      it('Should correctly track total supply with virtual lockups', async () => {
        const { veltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        const initialSupply = await veltxToken.totalSupply();

        const amountReleased = ethers.parseUnits('1000', 18);
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        const fromTimestamp = currentTime;
        const toTimestamp =
          currentTime + BigInt(dayjs.duration({ months: 36 }).as('seconds'));

        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            0n,
            amountReleased,
            fromTimestamp,
            toTimestamp,
          );

        // Total supply should increase
        expect(await veltxToken.totalSupply()).to.equal(
          initialSupply + amountReleased,
        );
      });

      it('Should correctly track ltxLockedBalanceOf excluding virtual lockups', async () => {
        const { veltxToken, ltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        // Create regular lockup
        await executeLock(
          { veltxToken, ltxToken, account: userAccountA },
          1000,
          36,
        );

        const ltxLockedAfterRegular = await veltxToken.ltxLockedBalanceOf(
          userAccountA.address,
        );
        expect(ltxLockedAfterRegular).to.equal(ethers.parseUnits('1000', 8));

        // Create virtual lockup
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            ethers.parseUnits('5000', 8),
            ethers.parseUnits('5000', 18),
            currentTime,
            currentTime + BigInt(dayjs.duration({ months: 36 }).as('seconds')),
          );

        // ltxLockedBalanceOf should remain the same (virtual lockups don't lock LTX)
        expect(
          await veltxToken.ltxLockedBalanceOf(userAccountA.address),
        ).to.equal(ethers.parseUnits('1000', 8));
      });
    });

    describe('Remove Virtual Lockups', async () => {
      it('Should remove virtual lockup that was unlocked in V1', async () => {
        const {
          veltxToken,
          veltxTokenV1,
          ownerAccount,
          userAccountA,
          ltxToken,
        } = await networkHelpers.loadFixture(deployTokens);

        const { lockupData: lockupDataV1 } = await executeLock(
          { veltxToken: veltxTokenV1, ltxToken, account: userAccountA },
          1000,
          36,
        );

        if (!lockupDataV1) {
          throw new Error('Lockup data not found');
        }

        // Create virtual lockup in V2 with same slot
        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            lockupDataV1.amountLocked,
            lockupDataV1.amountReleased,
            lockupDataV1.fromTimestamp,
            lockupDataV1.toTimestamp,
          );

        await executeUnlock(
          { veltxToken: veltxTokenV1, ltxToken, account: userAccountA },
          0,
          36,
        );

        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(
          lockupDataV1.amountReleased,
        );

        // Admin should be able to remove the virtual lockup
        const tx = await veltxToken
          .connect(ownerAccount)
          .adminRemoveVirtualLockup(userAccountA.address, 0);
        const receipt = await tx.wait();

        // Check event was emitted
        const event = receipt?.logs
          ?.map((log) => {
            try {
              return veltxToken.interface.parseLog({
                topics: [...log.topics],
                data: log.data,
              });
            } catch {
              return null;
            }
          })
          .find((parsed) => parsed?.name === 'VirtualLockupRemoved');

        expect(event).to.not.be.undefined;
        expect(event?.args?.user).to.equal(userAccountA.address);
        expect(Number(event?.args?.lockupSlot)).to.equal(0);
        expect(event?.args?.veLTXBurned).to.equal(lockupDataV1.amountReleased);

        // veLTX should be burned
        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(0n);

        // Lockup should be marked as withdrawn
        const lockup = await veltxToken.lockups(userAccountA.address, 0);
        expect(lockup.withdrawn).to.equal(true);
      });

      it('Should revert when removing lockup not unlocked in V1', async () => {
        const {
          veltxToken,
          veltxTokenV1,
          ownerAccount,
          userAccountA,
          ltxToken,
        } = await networkHelpers.loadFixture(deployTokens);

        // Provide balance and create lockup in V1 but dont unlock it
        const { lockupData: lockupDataV1 } = await executeLock(
          { veltxToken: veltxTokenV1, ltxToken, account: userAccountA },
          1000,
          36,
        );

        if (!lockupDataV1) {
          throw new Error('Lockup data not found');
        }

        // Create virtual lockup in V2
        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            lockupDataV1.amountLocked,
            lockupDataV1.amountReleased,
            lockupDataV1.fromTimestamp,
            lockupDataV1.toTimestamp,
          );

        // Attempt to remove should fail because V1 lockup is not unlocked
        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminRemoveVirtualLockup(userAccountA.address, 0),
        ).to.be.revertedWith('veLTX: Lockup not unlocked in V1');
      });

      it('Should revert when removing non-virtual lockup', async () => {
        const { veltxToken, ltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        // Create a regular lockup
        await executeLock(
          { veltxToken, ltxToken, account: userAccountA },
          1000,
          36,
        );

        // Attempt to remove should fail because it's not virtual
        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminRemoveVirtualLockup(userAccountA.address, 0),
        ).to.be.revertedWith('veLTX: Lockup is not virtual');
      });

      it('Should revert when removing already withdrawn lockup', async () => {
        const {
          veltxToken,
          veltxTokenV1,
          ownerAccount,
          userAccountA,
          ltxToken,
        } = await networkHelpers.loadFixture(deployTokens);

        // Setup and unlock in V1
        const { lockupData: lockupDataV1 } = await executeLock(
          { veltxToken: veltxTokenV1, ltxToken, account: userAccountA },
          1000,
          36,
        );

        if (!lockupDataV1) {
          throw new Error('Lockup data not found');
        }

        // Create and remove virtual lockup in V2
        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            lockupDataV1.amountLocked,
            lockupDataV1.amountReleased,
            lockupDataV1.fromTimestamp,
            lockupDataV1.toTimestamp,
          );

        await executeUnlock(
          { veltxToken: veltxTokenV1, ltxToken, account: userAccountA },
          0,
          36,
        );

        await veltxToken
          .connect(ownerAccount)
          .adminRemoveVirtualLockup(userAccountA.address, 0);

        // Attempt to remove again should fail
        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminRemoveVirtualLockup(userAccountA.address, 0),
        ).to.be.revertedWith('veLTX: Lockup already withdrawn');
      });

      it('Should revert when non-owner tries to remove', async () => {
        const { veltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        await veltxToken
          .connect(ownerAccount)
          .adminCreateVirtualLockup(
            userAccountA.address,
            ethers.parseUnits('1000', 8),
            ethers.parseUnits('1000', 18),
            currentTime,
            currentTime + BigInt(dayjs.duration({ months: 36 }).as('seconds')),
          );

        await expect(
          veltxToken
            .connect(userAccountA)
            .adminRemoveVirtualLockup(userAccountA.address, 0),
        ).to.be.revertedWithCustomError(
          veltxToken,
          'OwnableUnauthorizedAccount',
        );
      });

      it('Should revert with invalid user address', async () => {
        const { veltxToken, ownerAccount } =
          await networkHelpers.loadFixture(deployTokens);

        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminRemoveVirtualLockup(ethers.ZeroAddress, 0),
        ).to.be.revertedWith('veLTX: Invalid user address');
      });

      it('Should revert with non-existent lockup slot', async () => {
        const { veltxToken, ownerAccount, userAccountA } =
          await networkHelpers.loadFixture(deployTokens);

        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminRemoveVirtualLockup(userAccountA.address, 5),
        ).to.be.revertedWith('veLTX: Lockup slot not found');
      });
    });

    describe('Batch Remove Virtual Lockups', async () => {
      it('Should batch remove multiple virtual lockups', async () => {
        const {
          veltxToken,
          veltxTokenV1,
          ownerAccount,
          userAccountA,
          userAccountB,
          ltxToken,
        } = await networkHelpers.loadFixture(deployTokens);

        // Setup V1 lockups for both users
        await provideBalance(ltxToken, [
          [userAccountA.address, 1000],
          [userAccountB.address, 2000],
        ]);

        await ltxToken
          .connect(userAccountA)
          .approve(
            await veltxTokenV1.getAddress(),
            ethers.parseUnits('1000', 8),
          );
        await ltxToken
          .connect(userAccountB)
          .approve(
            await veltxTokenV1.getAddress(),
            ethers.parseUnits('2000', 8),
          );

        // Lock in V1
        await veltxTokenV1
          .connect(userAccountA)
          .lock(
            ethers.parseUnits('1000', 8),
            dayjs.duration({ months: 36 }).as('seconds'),
          );
        await veltxTokenV1
          .connect(userAccountB)
          .lock(
            ethers.parseUnits('2000', 8),
            dayjs.duration({ months: 36 }).as('seconds'),
          );

        // Fast forward and unlock in V1
        await networkHelpers.time.increase(
          dayjs.duration({ months: 36 }).as('seconds'),
        );
        await veltxTokenV1.connect(userAccountA).unlock(0);
        await veltxTokenV1.connect(userAccountB).unlock(0);

        // Create virtual lockups in V2
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        const fromTimestamp =
          currentTime - BigInt(dayjs.duration({ months: 36 }).as('seconds'));
        const toTimestamp = currentTime;

        await veltxToken
          .connect(ownerAccount)
          .adminBatchCreateVirtualLockups(
            [userAccountA.address, userAccountB.address],
            [ethers.parseUnits('1000', 8), ethers.parseUnits('2000', 8)],
            [ethers.parseUnits('1000', 18), ethers.parseUnits('2000', 18)],
            [fromTimestamp, fromTimestamp],
            [toTimestamp, toTimestamp],
          );

        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(
          ethers.parseUnits('1000', 18),
        );
        expect(await veltxToken.balanceOf(userAccountB.address)).to.equal(
          ethers.parseUnits('2000', 18),
        );

        // Batch remove
        await veltxToken
          .connect(ownerAccount)
          .adminBatchRemoveVirtualLockups(
            [userAccountA.address, userAccountB.address],
            [0, 0],
          );

        // Both should have veLTX burned
        expect(await veltxToken.balanceOf(userAccountA.address)).to.equal(0n);
        expect(await veltxToken.balanceOf(userAccountB.address)).to.equal(0n);
      });

      it('Should revert batch remove with array length mismatch', async () => {
        const { veltxToken, ownerAccount, userAccountA, userAccountB } =
          await networkHelpers.loadFixture(deployTokens);

        await expect(
          veltxToken.connect(ownerAccount).adminBatchRemoveVirtualLockups(
            [userAccountA.address, userAccountB.address],
            [0], // Mismatch
          ),
        ).to.be.revertedWith('veLTX: Array length mismatch');
      });

      it('Should revert batch remove if any lockup is invalid', async () => {
        const {
          veltxToken,
          veltxTokenV1,
          ownerAccount,
          userAccountA,
          userAccountB,
          ltxToken,
        } = await networkHelpers.loadFixture(deployTokens);

        // Setup only userA in V1
        await provideBalance(ltxToken, [[userAccountA.address, 1000]]);
        await ltxToken
          .connect(userAccountA)
          .approve(
            await veltxTokenV1.getAddress(),
            ethers.parseUnits('1000', 8),
          );

        await veltxTokenV1
          .connect(userAccountA)
          .lock(
            ethers.parseUnits('1000', 8),
            dayjs.duration({ months: 36 }).as('seconds'),
          );

        await networkHelpers.time.increase(
          dayjs.duration({ months: 36 }).as('seconds'),
        );
        await veltxTokenV1.connect(userAccountA).unlock(0);

        // Create virtual lockups in V2 for both users
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        await veltxToken
          .connect(ownerAccount)
          .adminBatchCreateVirtualLockups(
            [userAccountA.address, userAccountB.address],
            [ethers.parseUnits('1000', 8), ethers.parseUnits('2000', 8)],
            [ethers.parseUnits('1000', 18), ethers.parseUnits('2000', 18)],
            [currentTime, currentTime],
            [
              currentTime +
                BigInt(dayjs.duration({ months: 36 }).as('seconds')),
              currentTime +
                BigInt(dayjs.duration({ months: 36 }).as('seconds')),
            ],
          );

        // Batch remove should fail because userB's lockup doesn't exist in V1
        await expect(
          veltxToken
            .connect(ownerAccount)
            .adminBatchRemoveVirtualLockups(
              [userAccountA.address, userAccountB.address],
              [0, 0],
            ),
        ).to.be.revertedWith('veLTX: Lockup not unlocked in V1');
      });
    });
  });
});
