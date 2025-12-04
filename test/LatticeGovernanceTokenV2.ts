import { expect } from 'chai';
import dayjs from 'dayjs';
import hre from 'hardhat';

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

  const LatticeGovernanceTokenFactory = await ethers.getContractFactory(
    'LatticeGovernanceTokenV2',
  );
  const veltxToken = await LatticeGovernanceTokenFactory.connect(
    ownerAccount,
  ).deploy(await ltxToken.getAddress());

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

  return { ltxToken, veltxToken, ownerAccount, userAccountA, userAccountB };
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
  context: Awaited<ReturnType<typeof deployTokens>>,
  ltxLocked: number,
  lockTimeMonths: number,
  providedBalance = ltxLocked,
  providedAllowance = ltxLocked,
) => {
  const { veltxToken, ltxToken, userAccountA } = context;

  const decimalsLtx = await ltxToken.decimals();
  const decimalsVeltx = await veltxToken.decimals();

  await provideBalance(ltxToken, [[userAccountA.address, providedBalance]]);

  await ltxToken
    .connect(userAccountA)
    .approve(
      await veltxToken.getAddress(),
      ethers.parseUnits(String(providedAllowance), decimalsLtx),
    );

  const lockupSlot = Number(await veltxToken.lockupSlots(userAccountA.address));

  const lockTrxPromise = veltxToken
    .connect(userAccountA)
    .lock(
      ethers.parseUnits(String(ltxLocked), decimalsLtx),
      dayjs.duration({ months: lockTimeMonths }).as('seconds'),
    );

  return { decimalsLtx, decimalsVeltx, lockTrxPromise, lockupSlot };
};

const executeUnlock = async (
  context: Awaited<ReturnType<typeof deployTokens>>,
  lockupSlot: number,
  monthsAhead: number,
) => {
  const { veltxToken, ltxToken, userAccountA } = context;

  const decimalsLtx = await ltxToken.decimals();
  const decimalsVeltx = await veltxToken.decimals();

  await networkHelpers.time.increase(
    dayjs.duration({ months: monthsAhead }).as('seconds'),
  );

  const unlockTrxPromise = veltxToken.connect(userAccountA).unlock(lockupSlot);

  return { decimalsLtx, decimalsVeltx, unlockTrxPromise };
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
          const { veltxToken, userAccountA } = context;
          const { lockTrxPromise, decimalsLtx, decimalsVeltx } =
            await executeLock(context, ltxLocked, lockTimeMonths);

          const trx = await lockTrxPromise;
          const trxReceipt = await trx.wait();

          const lockEvent = trxReceipt?.logs
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
          const { veltxToken, userAccountA } = context;
          const { lockTrxPromise, decimalsLtx, decimalsVeltx } =
            await executeLock(context, ltxLocked, lockTimeMonths);

          const trx = await lockTrxPromise;
          const trxReceipt = await trx.wait();

          const lockEvent = trxReceipt?.logs
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
        const context = await networkHelpers.loadFixture(deployTokens);

        const { lockTrxPromise } = await executeLock(context, 2500, 32);

        await expect(lockTrxPromise).to.be.revertedWith(
          'veLTX: Lockup point does not exist',
        );
      });

      it('Reverts on not enough balance', async () => {
        const context = await networkHelpers.loadFixture(deployTokens);
        const { ltxToken, veltxToken, userAccountA } = context;

        const { decimalsLtx } = await executeLock(
          context,
          2500,
          36,
          5000,
          5000,
        );

        await ltxToken.burn(
          userAccountA.address,
          ethers.parseUnits(String(2500), decimalsLtx),
        );

        const lockTrxPromise = veltxToken
          .connect(userAccountA)
          .lock(
            ethers.parseUnits(String(2500), decimalsLtx),
            dayjs.duration({ months: 36 }).as('seconds'),
          );

        await expect(lockTrxPromise).to.be.revertedWithCustomError(
          veltxToken,
          'ERC20InsufficientBalance',
        );
      });

      it('Reverts on not enough allowance', async () => {
        const context = await networkHelpers.loadFixture(deployTokens);
        const { veltxToken, userAccountA } = context;

        const { decimalsLtx } = await executeLock(
          context,
          2500,
          36,
          5000,
          2500,
        );

        const lockTrxPromise = veltxToken
          .connect(userAccountA)
          .lock(
            ethers.parseUnits(String(2500), decimalsLtx),
            dayjs.duration({ months: 36 }).as('seconds'),
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
          const { lockTrxPromise, decimalsLtx, decimalsVeltx, lockupSlot } =
            await executeLock(context, ltxLocked, lockTimeMonths);
          await (await lockTrxPromise).wait();

          const { unlockTrxPromise } = await executeUnlock(
            context,
            lockupSlot,
            lockTimeMonths,
          );

          const trx = await unlockTrxPromise;
          const trxReceipt = await trx.wait();

          const unlockEvent = trxReceipt?.logs
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
        const { lockTrxPromise } = await executeLock(context, 1000, 36);
        await (await lockTrxPromise).wait();

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
        const context = await networkHelpers.loadFixture(deployTokens);
        const { veltxToken, ownerAccount, userAccountA } = context;

        // Create regular lockup
        const { lockTrxPromise } = await executeLock(context, 1000, 36);
        await (await lockTrxPromise).wait();

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
  });
});
