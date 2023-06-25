const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const {
  developmentChains,
  networkConfig,
} = require("../../helper-hardhat-config");
const { assert, expect } = require("chai");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Raffle Unit Test", async () => {
      let raffle,
        vrfCoordinatorV2Mock,
        chainId,
        raffleEntranceFee,
        deployer,
        interval;

      chainId = network.config.chainId;

      beforeEach(async () => {
        deployer = (await getNamedAccounts()).deployer;
        await deployments.fixture(["all"]);
        raffle = await ethers.getContract("Raffle", deployer);
        vrfCoordinatorV2Mock = await ethers.getContract(
          "VRFCoordinatorV2Mock",
          deployer
        );
        raffleEntranceFee = await raffle.getEntranceFee();
        interval = await raffle.getInterval();
      });

      describe("Constructor", () => {
        it("initialized the raffle correctly", async () => {
          const raffleState = await raffle.getRaffleState();
          const interval = await raffle.getInterval();
          const entranceFee = await raffle.getEntranceFee();
          const gasLane = await raffle.getGasLane();
          const transactionResponse =
            await vrfCoordinatorV2Mock.createSubscription();
          const transactionReceipt = await transactionResponse.wait(1);
          const mockSubId = transactionReceipt.events[0].args.subId.toString();
          const subId = await raffle.getSubId();
          const callbackGasLimit = await raffle.getCallbackGasLimit();
          const vrfCoordinatorV2Address = await raffle.getVRFCoordinator();

          assert.equal(raffleState.toString(), "0");
          assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
          assert.equal(
            entranceFee.toString(),
            networkConfig[chainId]["entranceFee"]
          );
          assert.equal(gasLane, networkConfig[chainId]["gasLane"]);
          assert.equal(subId.toString(), mockSubId - 1);
          assert.equal(
            callbackGasLimit.toString(),
            networkConfig[chainId]["callbackGasLimit"]
          );
          assert(vrfCoordinatorV2Address, vrfCoordinatorV2Mock.address);
        });
      });

      describe("enterRaffle", () => {
        it("revert when you dont't pay enough", async () => {
          await expect(raffle.enterRaffle()).to.be.revertedWith(
            "Raffle__NotEnoughETHEnter"
          );
        });

        it("record players when they enter", async () => {
          await raffle.enterRaffle({
            value: raffleEntranceFee,
          });
          const player = await raffle.getPlayer(0);
          assert.equal(player, deployer);
        });

        it("emit event on enter", async () => {
          await expect(
            raffle.enterRaffle({ value: raffleEntranceFee })
          ).to.emit(raffle, "RaffleEnter");
        });

        it("does'nt allow to entrance raffle when raffle is calculating", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          await raffle.performUpkeep([]);
          await expect(
            raffle.enterRaffle({ value: raffleEntranceFee })
          ).to.be.revertedWith("Raffle__NotOpen");
        });
      });
    });
