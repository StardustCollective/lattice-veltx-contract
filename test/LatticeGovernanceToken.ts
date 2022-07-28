import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, ContractTransaction } from "ethers";

import dayjs from "../utils/dayjs";
import { LatticeToken } from "../typechain-types";
import { LockedEvent } from "../typechain-types/contracts/LatticeGovernanceToken";

const LOCKUP_POINTS = [
  [dayjs.duration({ months: 6 }), 0.25],
  [dayjs.duration({ months: 12 }), 0.5],
  [dayjs.duration({ months: 24 }), 0.75],
  [dayjs.duration({ months: 36 }), 1],
] as const;

const TOKEN_EXPONENT_DIFF = 10;
const SECONDS_IN_MONTH = 60 * 60 * 24 * 30;

describe("LatticeGovernanceToken", function () {
  const deployTokens = async () => {
    const [ownerAccount, userAccountA, userAccountB] =
      await ethers.getSigners();

    const LatticeTokenFactory = await ethers.getContractFactory("LatticeToken");
    const ltxToken = await LatticeTokenFactory.deploy();

    const LatticeGovernanceTokenFactory = await ethers.getContractFactory(
      "LatticeGovernanceToken"
    );
    const veltxToken = await LatticeGovernanceTokenFactory.deploy(
      ltxToken.address
    );

    const exponentDiff =
      (await veltxToken.decimals()) - (await ltxToken.decimals());

    for (const [lockupTime, tokenPercentageReleased] of LOCKUP_POINTS) {
      await veltxToken["setLockupPoint(uint256,uint256)"](
        lockupTime.as("seconds"),
        tokenPercentageReleased * 10 ** exponentDiff
      );
    }

    return { ltxToken, veltxToken, ownerAccount, userAccountA, userAccountB };
  };

  const provideBalance = async (
    ltxToken: LatticeToken,
    balances: [string, number][]
  ) => {
    const decimals = await ltxToken.decimals();

    for (const [account, balance] of balances) {
      await ltxToken.mint(
        account,
        ethers.utils.parseUnits(String(balance), decimals)
      );
    }
  };
  /* // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshopt in every test.
  async function deployOneYearLockFixture() {
    const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;
    const ONE_GWEI = 1_000_000_000;

    const lockedAmount = ONE_GWEI;
    const unlockTime = (await time.latest()) + ONE_YEAR_IN_SECS;

    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners();

    const Lock = await ethers.getContractFactory("Lock");
    const lock = await Lock.deploy(unlockTime, { value: lockedAmount });

    return { lock, unlockTime, lockedAmount, owner, otherAccount };
  } */

  describe("Deploys", async () => {
    it("Deploys with right owner", async () => {
      const { veltxToken, ownerAccount } = await loadFixture(deployTokens);

      expect(await veltxToken.owner()).to.equal(ownerAccount.address);
    });

    it("Deploys not paused", async () => {
      const { veltxToken } = await loadFixture(deployTokens);

      expect(await veltxToken.paused()).to.equal(false);
    });

    it("Deploys veLTX With 18 decimals", async () => {
      const { veltxToken } = await loadFixture(deployTokens);

      expect(await veltxToken.decimals()).to.equal(18);
    });

    it("Deploys LTX With 8 decimals", async () => {
      const { ltxToken } = await loadFixture(deployTokens);

      expect(await ltxToken.decimals()).to.equal(8);
    });

    it("Deploys with right lockup times", async () => {
      const { veltxToken } = await loadFixture(deployTokens);

      expect(
        (await veltxToken.lockupPoints(6 * SECONDS_IN_MONTH)).toNumber()
      ).to.equal(0.25 * 10 ** TOKEN_EXPONENT_DIFF);

      expect(
        (await veltxToken.lockupPoints(12 * SECONDS_IN_MONTH)).toNumber()
      ).to.equal(0.5 * 10 ** TOKEN_EXPONENT_DIFF);

      expect(
        (await veltxToken.lockupPoints(24 * SECONDS_IN_MONTH)).toNumber()
      ).to.equal(0.75 * 10 ** TOKEN_EXPONENT_DIFF);

      expect(
        (await veltxToken.lockupPoints(36 * SECONDS_IN_MONTH)).toNumber()
      ).to.equal(1 * 10 ** TOKEN_EXPONENT_DIFF);
    });
  });

  describe("Locks", async () => {
    const executeLock = async (
      context: Awaited<ReturnType<typeof deployTokens>>,
      ltxLocked: number,
      lockTimeMonths: number,
      providedBalance = ltxLocked,
      providedAllowance = ltxLocked
    ) => {
      const { veltxToken, ltxToken, userAccountA } = context;

      const decimalsLtx = await ltxToken.decimals();
      const decimalsVeltx = await veltxToken.decimals();

      await provideBalance(ltxToken, [[userAccountA.address, providedBalance]]);

      await ltxToken
        .connect(userAccountA)
        .approve(
          veltxToken.address,
          ethers.utils.parseUnits(String(providedAllowance), decimalsLtx)
        );

      const lockTrxPromise = veltxToken
        .connect(userAccountA)
        .lock(
          ethers.utils.parseUnits(String(ltxLocked), decimalsLtx),
          lockTimeMonths * SECONDS_IN_MONTH
        );

      return { decimalsLtx, decimalsVeltx, lockTrxPromise };
    };

    describe("Basic", async () => {
      const testBasicLockup = (
        ltxLocked: number,
        lockTimeMonths: number,
        veltxReleased: number
      ) => {
        it(`Locks ${ltxLocked} LTX for ${lockTimeMonths} months to receive ${veltxReleased} veLTX`, async () => {
          const context = await loadFixture(deployTokens);
          const { veltxToken, userAccountA } = context;
          const { lockTrxPromise, decimalsLtx, decimalsVeltx } =
            await executeLock(context, ltxLocked, lockTimeMonths);

          const trx = await lockTrxPromise;
          const trxReceipt = await trx.wait();

          if (!trxReceipt.events) {
            throw new Error("TrxReceipt events is undefined");
          }

          const lockEvent = trxReceipt.events.find(
            (event) => event.event === "Locked"
          ) as LockedEvent;

          expect(lockEvent.args.user).to.equal(userAccountA.address);
          expect(lockEvent.args.lockupTime).to.equal(
            lockTimeMonths * SECONDS_IN_MONTH
          );
          expect(lockEvent.args.lockupSlot.toNumber()).to.equal(0);
          expect(
            lockEvent.args.amountLocked.eq(
              ethers.utils.parseUnits(String(ltxLocked), decimalsLtx)
            )
          ).to.equal(true);
          expect(
            lockEvent.args.amountReleased.eq(
              ethers.utils.parseUnits(String(veltxReleased), decimalsVeltx)
            )
          ).to.equal(true);

          expect(
            parseFloat(
              ethers.utils.formatUnits(
                await veltxToken.balanceOf(userAccountA.address),
                decimalsVeltx
              )
            )
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

    describe("Locks multiple times", async () => {
      const testMultipleLockup = (
        lockTimes: number,
        ltxLocked: number,
        lockTimeMonths: number,
        veltxReleased: number
      ) => {
        const executeLockAndTest = async (
          context: Awaited<ReturnType<typeof deployTokens>>,
          lockupSlot: number,
          totalVeltxReleased: number
        ) => {
          const { veltxToken, userAccountA } = context;
          const { lockTrxPromise, decimalsLtx, decimalsVeltx } =
            await executeLock(context, ltxLocked, lockTimeMonths);

          const trx = await lockTrxPromise;
          const trxReceipt = await trx.wait();

          if (!trxReceipt.events) {
            throw new Error("TrxReceipt events is undefined");
          }

          const lockEvent = trxReceipt.events.find(
            (event) => event.event === "Locked"
          ) as LockedEvent;

          expect(lockEvent.args.user).to.equal(userAccountA.address);
          expect(lockEvent.args.lockupTime).to.equal(
            lockTimeMonths * SECONDS_IN_MONTH
          );
          expect(lockEvent.args.lockupSlot.toNumber()).to.equal(lockupSlot);
          expect(
            lockEvent.args.amountLocked.eq(
              ethers.utils.parseUnits(String(ltxLocked), decimalsLtx)
            )
          ).to.equal(true);
          expect(
            lockEvent.args.amountReleased.eq(
              ethers.utils.parseUnits(String(veltxReleased), decimalsVeltx)
            )
          ).to.equal(true);

          expect(
            parseFloat(
              ethers.utils.formatUnits(
                await veltxToken.balanceOf(userAccountA.address),
                decimalsVeltx
              )
            )
          ).to.approximately(totalVeltxReleased, 0.0001);
        };

        it(`Locks ${lockTimes} times for ${lockTimeMonths} months`, async () => {
          const context = await loadFixture(deployTokens);

          for (let i = 0; i < lockTimes; i++) {
            await executeLockAndTest(context, i, (i + 1) * veltxReleased);
          }

          expect(
            (
              await context.veltxToken.lockupSlots(context.userAccountA.address)
            ).toNumber()
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

    describe("Reverts", async () => {
      it("Reverts on not existent lockup point", async () => {
        const context = await loadFixture(deployTokens);

        const { lockTrxPromise } = await executeLock(context, 2500, 32);

        await expect(lockTrxPromise).to.be.revertedWith(
          "veLTX: Lockup point does not exist"
        );
      });

      it("Reverts on not enough balance", async () => {
        const context = await loadFixture(deployTokens);
        const { ltxToken, veltxToken, userAccountA } = context;

        const { decimalsLtx } = await executeLock(
          context,
          2500,
          36,
          5000,
          5000
        );

        await ltxToken.burn(
          userAccountA.address,
          ethers.utils.parseUnits(String(2500), decimalsLtx)
        );

        const lockTrxPromise = veltxToken
          .connect(userAccountA)
          .lock(
            ethers.utils.parseUnits(String(2500), decimalsLtx),
            36 * SECONDS_IN_MONTH
          );

        await expect(lockTrxPromise).to.be.revertedWith(
          "ERC20: transfer amount exceeds balance"
        );
      });

      it("Reverts on not enough allowance", async () => {
        const context = await loadFixture(deployTokens);
        const { veltxToken, userAccountA } = context;

        const { decimalsLtx } = await executeLock(
          context,
          2500,
          36,
          5000,
          2500
        );

        const lockTrxPromise = veltxToken
          .connect(userAccountA)
          .lock(
            ethers.utils.parseUnits(String(2500), decimalsLtx),
            36 * SECONDS_IN_MONTH
          );

        await expect(lockTrxPromise).to.be.revertedWith(
          "ERC20: insufficient allowance"
        );
      });
    });
  });
});
