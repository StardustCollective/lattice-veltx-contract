import { expect } from 'chai';
import hre from 'hardhat';

const { ethers, networkHelpers } = await hre.network.connect();

describe('LatticeGovernanceTokenDeployer', function () {
  const deployDeployer = async () => {
    const [ownerAccount, userAccountA, userAccountB] =
      await ethers.getSigners();

    const LatticeTokenFactory =
      await ethers.getContractFactory('TestLatticeToken');
    const ltxToken = await LatticeTokenFactory.deploy();

    const DeployerFactory = await ethers.getContractFactory(
      'LatticeGovernanceTokenDeployer',
    );
    const deployer = await DeployerFactory.deploy();

    return { deployer, ltxToken, ownerAccount, userAccountA, userAccountB };
  };

  describe('Deployment', async () => {
    it('Deploys deployer contract', async () => {
      const { deployer } = await networkHelpers.loadFixture(deployDeployer);
      expect(await deployer.getAddress()).to.be.properAddress;
    });
  });

  describe('Compute Address', async () => {
    it('Computes deterministic address', async () => {
      const { deployer, ltxToken } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('test-salt-1');
      const predictedAddress = await deployer.computeAddress(
        await ltxToken.getAddress(),
        salt,
      );

      expect(predictedAddress).to.be.properAddress;
      expect(predictedAddress).to.not.equal(ethers.ZeroAddress);
    });

    it('Returns same address for same inputs', async () => {
      const { deployer, ltxToken } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('test-salt-2');
      const ltxAddress = await ltxToken.getAddress();
      const address1 = await deployer.computeAddress(ltxAddress, salt);
      const address2 = await deployer.computeAddress(ltxAddress, salt);

      expect(address1).to.equal(address2);
    });

    it('Returns different address for different salts', async () => {
      const { deployer, ltxToken } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt1 = ethers.encodeBytes32String('salt-1');
      const salt2 = ethers.encodeBytes32String('salt-2');

      const ltxAddress = await ltxToken.getAddress();
      const address1 = await deployer.computeAddress(ltxAddress, salt1);
      const address2 = await deployer.computeAddress(ltxAddress, salt2);

      expect(address1).to.not.equal(address2);
    });

    it('Returns different address for different LTX tokens', async () => {
      const { deployer, ltxToken } =
        await networkHelpers.loadFixture(deployDeployer);

      // Deploy second LTX token
      const LatticeTokenFactory =
        await ethers.getContractFactory('TestLatticeToken');
      const ltxToken2 = await LatticeTokenFactory.deploy();

      const salt = ethers.encodeBytes32String('test-salt');

      const address1 = await deployer.computeAddress(
        await ltxToken.getAddress(),
        salt,
      );
      const address2 = await deployer.computeAddress(
        await ltxToken2.getAddress(),
        salt,
      );

      expect(address1).to.not.equal(address2);
    });
  });

  describe('Deploy', async () => {
    it('Deploys contract to predicted address', async () => {
      const { deployer, ltxToken, userAccountA } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('deploy-test-1');
      const ltxAddress = await ltxToken.getAddress();
      const predictedAddress = await deployer.computeAddress(ltxAddress, salt);

      const trx = await deployer
        .connect(userAccountA)
        .deployDeterministic(ltxAddress, salt);
      const receipt = await trx.wait();

      // Check event was emitted
      const event = receipt?.logs?.find((log) => {
        try {
          const parsed = deployer.interface.parseLog({
            topics: [...log.topics],
            data: log.data,
          });
          return parsed?.name === 'ContractDeployed';
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
      const parsedEvent = deployer.interface.parseLog({
        topics: [...event!.topics],
        data: event!.data,
      });
      expect(parsedEvent?.args?.deployedAddress).to.equal(predictedAddress);
      expect(parsedEvent?.args?.owner).to.equal(userAccountA.address);
      expect(parsedEvent?.args?.ltxToken).to.equal(ltxAddress);
      expect(parsedEvent?.args?.salt).to.equal(salt);

      // Check contract was deployed
      const code = await ethers.provider.getCode(predictedAddress);
      expect(code).to.not.equal('0x');
    });

    it('Transfers ownership to msg.sender', async () => {
      const { deployer, ltxToken, userAccountA } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('ownership-test');
      const ltxAddress = await ltxToken.getAddress();
      const predictedAddress = await deployer.computeAddress(ltxAddress, salt);

      await deployer
        .connect(userAccountA)
        .deployDeterministic(ltxAddress, salt);

      // Get the deployed contract
      const VeLTXFactory = await ethers.getContractFactory(
        'LatticeGovernanceTokenV2',
      );
      const veLTX = VeLTXFactory.attach(predictedAddress);

      // Check ownership
      expect(await veLTX.owner()).to.equal(userAccountA.address);
    });

    it('Reverts when deploying to same address twice', async () => {
      const { deployer, ltxToken, userAccountA } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('duplicate-test');
      const ltxAddress = await ltxToken.getAddress();

      // First deployment succeeds
      await deployer
        .connect(userAccountA)
        .deployDeterministic(ltxAddress, salt);

      // Second deployment with same salt should fail
      await expect(
        deployer.connect(userAccountA).deployDeterministic(ltxAddress, salt),
      ).to.revert(ethers);
    });

    it('Different users can deploy with same salt', async () => {
      const { deployer, ltxToken, userAccountA, userAccountB } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('multi-user-test');
      const ltxAddress = await ltxToken.getAddress();

      // Both users deploy - should get same address since deployer is the factory
      await deployer.computeAddress(ltxAddress, salt);

      // First user deploys
      await deployer
        .connect(userAccountA)
        .deployDeterministic(ltxAddress, salt);

      // Second user cannot deploy with same salt (address already taken)
      await expect(
        deployer.connect(userAccountB).deployDeterministic(ltxAddress, salt),
      ).to.revert(ethers);

      // But second user can deploy with different salt
      const salt2 = ethers.encodeBytes32String('multi-user-test-2');
      await expect(
        deployer.connect(userAccountB).deployDeterministic(ltxAddress, salt2),
      ).to.not.revert(ethers);
    });

    it('Deploys functional veLTX contract', async () => {
      const { deployer, ltxToken, userAccountA } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('functional-test');
      const ltxAddress = await ltxToken.getAddress();
      const predictedAddress = await deployer.computeAddress(ltxAddress, salt);

      await deployer
        .connect(userAccountA)
        .deployDeterministic(ltxAddress, salt);

      // Get the deployed contract
      const VeLTXFactory = await ethers.getContractFactory(
        'LatticeGovernanceTokenV2',
      );
      const veLTX = VeLTXFactory.attach(predictedAddress);

      // Test basic functionality
      expect(await veLTX.name()).to.equal('LatticeGovernanceToken');
      expect(await veLTX.symbol()).to.equal('veLTX');
      expect(await veLTX.decimals()).to.equal(18);
      expect(await veLTX.paused()).to.equal(false);
      expect(await veLTX.virtualLockupsDisabled()).to.equal(false);
    });

    it('Emits ContractDeployed event with correct parameters', async () => {
      const { deployer, ltxToken, userAccountA } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('event-test');
      const ltxAddress = await ltxToken.getAddress();
      const predictedAddress = await deployer.computeAddress(ltxAddress, salt);

      await expect(
        deployer.connect(userAccountA).deployDeterministic(ltxAddress, salt),
      )
        .to.emit(deployer, 'ContractDeployed')
        .withArgs(predictedAddress, userAccountA.address, ltxAddress, salt);
    });
  });

  describe('Is Deployed', async () => {
    it('Returns false before deployment', async () => {
      const { deployer, ltxToken } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('not-deployed');
      const ltxAddress = await ltxToken.getAddress();
      const isDeployed = await deployer.isDeployed(ltxAddress, salt);

      expect(isDeployed).to.equal(false);
    });

    it('Returns true after deployment', async () => {
      const { deployer, ltxToken, userAccountA } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('is-deployed-test');
      const ltxAddress = await ltxToken.getAddress();

      // Before deployment
      expect(await deployer.isDeployed(ltxAddress, salt)).to.equal(false);

      // Deploy
      await deployer
        .connect(userAccountA)
        .deployDeterministic(ltxAddress, salt);

      // After deployment
      expect(await deployer.isDeployed(ltxAddress, salt)).to.equal(true);
    });

    it('Returns false for different salt', async () => {
      const { deployer, ltxToken, userAccountA } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt1 = ethers.encodeBytes32String('deployed-salt');
      const salt2 = ethers.encodeBytes32String('not-deployed-salt');
      const ltxAddress = await ltxToken.getAddress();

      // Deploy with salt1
      await deployer
        .connect(userAccountA)
        .deployDeterministic(ltxAddress, salt1);

      // Check both salts
      expect(await deployer.isDeployed(ltxAddress, salt1)).to.equal(true);
      expect(await deployer.isDeployed(ltxAddress, salt2)).to.equal(false);
    });
  });

  describe('Deterministic Address Verification', async () => {
    it('Multiple deployers produce different addresses for same salt', async () => {
      const { ltxToken } = await networkHelpers.loadFixture(deployDeployer);

      // Deploy two separate deployer contracts
      const DeployerFactory = await ethers.getContractFactory(
        'LatticeGovernanceTokenDeployer',
      );
      const deployer1 = await DeployerFactory.deploy();
      const deployer2 = await DeployerFactory.deploy();

      const salt = ethers.encodeBytes32String('same-salt');
      const ltxAddress = await ltxToken.getAddress();

      const address1 = await deployer1.computeAddress(ltxAddress, salt);
      const address2 = await deployer2.computeAddress(ltxAddress, salt);

      // Different deployer contracts = different addresses (CREATE2 includes factory address)
      expect(address1).to.not.equal(address2);
    });

    it('Same deployer produces same address across calls', async () => {
      const { deployer, ltxToken } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.encodeBytes32String('consistency-test');
      const ltxAddress = await ltxToken.getAddress();

      const addresses = await Promise.all([
        deployer.computeAddress(ltxAddress, salt),
        deployer.computeAddress(ltxAddress, salt),
        deployer.computeAddress(ltxAddress, salt),
      ]);

      expect(addresses[0]).to.equal(addresses[1]);
      expect(addresses[1]).to.equal(addresses[2]);
    });
  });

  describe('Edge Cases', async () => {
    it('Works with zero salt', async () => {
      const { deployer, ltxToken, userAccountA } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt = ethers.ZeroHash;
      const ltxAddress = await ltxToken.getAddress();
      const predictedAddress = await deployer.computeAddress(ltxAddress, salt);

      await deployer
        .connect(userAccountA)
        .deployDeterministic(ltxAddress, salt);

      const code = await ethers.provider.getCode(predictedAddress);
      expect(code).to.not.equal('0x');
    });

    it('Works with max bytes32 salt', async () => {
      const { deployer, ltxToken, userAccountA } =
        await networkHelpers.loadFixture(deployDeployer);

      const salt =
        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      const ltxAddress = await ltxToken.getAddress();
      const predictedAddress = await deployer.computeAddress(ltxAddress, salt);

      await deployer
        .connect(userAccountA)
        .deployDeterministic(ltxAddress, salt);

      const code = await ethers.provider.getCode(predictedAddress);
      expect(code).to.not.equal('0x');
    });
  });
});
