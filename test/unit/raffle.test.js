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

      describe("checkUpKeep", () => {
        it("returns false if people has not sent enough fund", async () => {
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
          assert(!upkeepNeeded);
        });

        it("returns false if raffle isn't open", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          await raffle.performUpkeep([]);
          const raffleState = await raffle.getRaffleState();
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);

          assert.equal(raffleState, "1");
          assert(!upkeepNeeded);
        });

        it("returns false if enough time has not passed", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() - 2,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
          assert(!upkeepNeeded);
        });

        it("returns true if enough time has passed, has player and in open state ", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine");
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
          assert(upkeepNeeded);
        });
      });

      describe("performUpKeep", () => {
        it("it can only run if cheekUpKeep is true", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const transactionResponse = await raffle.performUpkeep("0x");
          assert(transactionResponse);
        });

        it("revert if cheekUpKeep is false", async () => {
          await expect(raffle.performUpkeep("0x")).to.be.revertedWith(
            "Raffle__UpkeepNotNeeded"
          );
        });

        describe("performUpKeep work", () => {
          beforeEach(async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee });
            await network.provider.send("evm_increaseTime", [
              interval.toNumber() + 1,
            ]);
            await network.provider.send("evm_mine");
          });

          it("update raffle state to calculating", async () => {
            await raffle.performUpkeep("0x");
            const raffleState = await raffle.getRaffleState();
            assert.equal(raffleState, 1);
          });

          it("emit an event", async () => {
            await expect(raffle.performUpkeep([])).to.emit(
              raffle,
              "RequestedRandomWinner"
            );
          });

          it("call vrfCoordinator", async () => {
            const transactionResponse = await raffle.performUpkeep([]);
            const transactionReceipt = await transactionResponse.wait();
            const requestId =
              transactionReceipt.events[1].args.requestId.toNumber();
            assert(requestId);
          });
        });

        describe("fulfillRandomWords", () => {
          beforeEach(async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee });
            await network.provider.send("evm_increaseTime", [
              interval.toNumber() + 1,
            ]);
            await network.provider.send("evm_mine", []);
          });

          it("can only be called after performUpkeep", async () => {
            await expect(
              vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
            ).to.be.revertedWith("nonexistent request");
            await expect(
              vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
            ).to.be.revertedWith("nonexistent request");
          });

          it("pick a winner, resets the lottery and sends money", async () => {
            const additionalEntrance = 3;
            const startingAccountIndex = 1; // deployer is 0
            const accounts = await ethers.getSigners();
            for (
              let i = startingAccountIndex;
              i < startingAccountIndex + additionalEntrance;
              i++
            ) {
              const accountConnectedRaffle = raffle.connect(accounts[i]);
              await accountConnectedRaffle.enterRaffle({
                value: raffleEntranceFee,
              });
            }
            const startingTimeStamp = await raffle.getLastTimeStamp();

            // performUpkeep(mock being chainLink keepers)
            // fulfillRandomWords (mock being the chainLink VRF)

            await new Promise(async (res, rej) => {
              console.log("Found the event!");
              raffle.once("WinnerPicked", async () => {
                try {
                  const recentWinner = await raffle.getRecentWinner();
                  console.log(recentWinner);
                  console.log(accounts[0].address);
                  console.log(accounts[1].address);
                  console.log(accounts[2].address);
                  console.log(accounts[3].address);

                  const raffleState = await raffle.getRaffleState();
                  const endingTimeStamp = await raffle.getLastTimeStamp();
                  const numPlayer = await raffle.getNumberOfPlayers();
                  const winnerEndingBalance = await accounts[1].getBalance();

                  assert.equal(
                    winnerEndingBalance.toString(),
                    winnerStartingBalance.add(
                      raffleEntranceFee
                        .mul(additionalEntrance)
                        .add(raffleEntranceFee)
                        .toString()
                    )
                  );
                  assert.equal(numPlayer.toString(), "0");
                  assert.equal(raffleState.toString(), "0");
                  assert(endingTimeStamp > startingTimeStamp);
                } catch (error) {
                  rej(error);
                }
                res();
              });
              // setting up the listener
              // below, we will fire the event
              const transactionResponse = await raffle.performUpkeep("0x");
              const transactionReceipt = await transactionResponse.wait(1);
              const winnerStartingBalance = await accounts[1].getBalance();
              await vrfCoordinatorV2Mock.fulfillRandomWords(
                transactionReceipt.events[1].args.requestId,
                raffle.address
              );
            });
          });
        });
      });
    });
