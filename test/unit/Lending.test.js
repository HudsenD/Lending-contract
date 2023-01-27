const { assert, expect } = require("chai")
const { BigNumber } = require("ethers")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
const { INITIAL_SUPPLY } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lending Tests", function () {
          let lending, usdcToken, hdToken, deployer, player, lendingPlayer, usdcTokenPlayer, hdTokenPlayer
          const SWAPAMOUNT = ethers.utils.parseEther("10")
          const UNSAFEBORROW = ethers.utils.parseEther("7.52")
          const SAFEBORROW = ethers.utils.parseEther("7.5")
          const LIQUIDITYAMOUNT = ethers.utils.parseEther("1000")
          const RANDOMADDRESS = "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"
          provider = ethers.provider

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              player = (await getNamedAccounts()).player
              await deployments.fixture(["all"])
              lending = await ethers.getContract("Lending")
              lendingPlayer = await ethers.getContract("Lending", player)
              usdcToken = await ethers.getContract("UsdcToken")
              usdcTokenPlayer = await ethers.getContract("UsdcToken", player)
              hdToken = await ethers.getContract("HdToken")
              hdTokenPlayer = await ethers.getContract("HdToken", player)
              await usdcToken.approve(deployer, LIQUIDITYAMOUNT)
              await usdcToken.transferFrom(deployer, player, LIQUIDITYAMOUNT)
              await hdToken.approve(deployer, LIQUIDITYAMOUNT)
              await hdToken.transferFrom(deployer, player, LIQUIDITYAMOUNT)
          })
          describe("deposit", function () {
              it("deposits ERC20 tokens and updates balance correctly", async function () {
                  const initialBalance = await lending.getUserToTokenDeposits(deployer, usdcToken.address)
                  await usdcToken.approve(lending.address, SWAPAMOUNT)
                  const tx = await lending.deposit(usdcToken.address, SWAPAMOUNT)
                  await tx.wait(1)
                  const finalBalance = await lending.getUserToTokenDeposits(deployer, usdcToken.address)
                  assert.equal(initialBalance.toString(), "0")
                  assert.equal(finalBalance.toString(), SWAPAMOUNT.toString())
              })
              it("emits Deposit event", async function () {
                  await usdcToken.approve(lending.address, SWAPAMOUNT)
                  expect(await lending.deposit(usdcToken.address, SWAPAMOUNT)).to.emit("Deposit")
              })
              it("reverts if token is not approved", async function () {
                  await expect(lending.deposit(RANDOMADDRESS, SWAPAMOUNT)).to.be.revertedWith("TokenNotApproved")
              })
          })
          describe("withdraw", function () {
              it("updates and withdraws users assets correctly", async function () {
                  // deposit so we can withdraw
                  await usdcToken.approve(lending.address, SWAPAMOUNT)
                  const tx = await lending.deposit(usdcToken.address, SWAPAMOUNT)
                  await tx.wait(1)
                  const initialBalance = await lending.getUserToTokenDeposits(deployer, usdcToken.address)
                  await lending.withdraw(usdcToken.address, SWAPAMOUNT)
                  const finalBalance = await lending.getUserToTokenDeposits(deployer, usdcToken.address)
                  assert.equal(SWAPAMOUNT, initialBalance.toString())
                  assert.equal(finalBalance.toString(), "0")
              })
              it("reverts if user tries to withdraw more then deposited", async function () {
                  await usdcToken.approve(lending.address, SWAPAMOUNT)
                  const tx = await lending.deposit(usdcToken.address, SWAPAMOUNT)
                  await tx.wait(1)
                  await expect(lending.withdraw(usdcToken.address, LIQUIDITYAMOUNT)).to.be.revertedWith(
                      "Insufficient Funds"
                  )
              })
              it("reverts if withdraw would change saftey factor to unhealthy", async function () {
                  await usdcToken.approve(lending.address, SWAPAMOUNT)
                  await lending.deposit(usdcToken.address, SWAPAMOUNT)
                  await hdTokenPlayer.approve(lending.address, LIQUIDITYAMOUNT)
                  await lendingPlayer.deposit(hdToken.address, LIQUIDITYAMOUNT)
                  await lending.borrow(hdToken.address, SAFEBORROW)
                  await expect(lending.withdraw(usdcToken.address, ethers.utils.parseEther("0.03"))).to.be.revertedWith(
                      "You will get Liquidated!"
                  )
              })
              it("emits Withdraw event", async function () {
                  await usdcToken.approve(lending.address, SWAPAMOUNT)
                  await lending.deposit(usdcToken.address, SWAPAMOUNT)
                  expect(await lending.withdraw(usdcToken.address, SWAPAMOUNT)).to.emit("Withdraw")
              })
          })
          describe("borrow", function () {
              it("lets users borrow and updates balances correctly", async function () {
                  // deposit for collateral
                  await usdcToken.approve(lending.address, LIQUIDITYAMOUNT)
                  const tx = await lending.deposit(usdcToken.address, LIQUIDITYAMOUNT)
                  await tx.wait(1)
                  // other user deposits hd token so we can borrow
                  await hdTokenPlayer.approve(lending.address, LIQUIDITYAMOUNT)
                  await lendingPlayer.deposit(hdToken.address, LIQUIDITYAMOUNT)
                  //original user borrows hdtoken
                  const initialBalance = await lending.getUserToTokenBorrows(deployer, hdToken.address)
                  await lending.borrow(hdToken.address, SWAPAMOUNT) // with this, safety factor is 1e18. I think it keeps returning this
                  const finalBalance = await lending.getUserToTokenBorrows(deployer, hdToken.address)
                  assert.equal(finalBalance.toString() - SWAPAMOUNT, initialBalance.toString())
              })
              it("reverts if insufficent tokens are in platform", async function () {
                  await usdcToken.approve(lending.address, LIQUIDITYAMOUNT)
                  await lending.deposit(usdcToken.address, LIQUIDITYAMOUNT)
                  await expect(lending.borrow(hdToken.address, SWAPAMOUNT)).to.be.revertedWith(
                      "InsufficentTokensInPlatform"
                  )
              })
              it("emits Borrow event", async function () {
                  await usdcToken.approve(lending.address, LIQUIDITYAMOUNT)
                  await lending.deposit(usdcToken.address, LIQUIDITYAMOUNT)
                  await hdTokenPlayer.approve(lending.address, LIQUIDITYAMOUNT)
                  await lendingPlayer.deposit(hdToken.address, LIQUIDITYAMOUNT)
                  expect(await lending.borrow(hdToken.address, SWAPAMOUNT)).to.emit("Borrow")
              })
              it("reverts if user tries to borrow too much", async function () {
                  // price feed returns 1000000000000000
                  await usdcToken.approve(lending.address, SWAPAMOUNT)
                  await lending.deposit(usdcToken.address, SWAPAMOUNT)
                  await hdTokenPlayer.approve(lending.address, LIQUIDITYAMOUNT)
                  await lendingPlayer.deposit(hdToken.address, LIQUIDITYAMOUNT)
                  await expect(lending.borrow(hdToken.address, UNSAFEBORROW)).to.be.revertedWith("Deposit more value!")
              })
          })
          describe("liquidate", function () {
              it("reverts if user has good safety factor", async function () {
                  await usdcToken.approve(lending.address, SWAPAMOUNT)
                  await lending.deposit(usdcToken.address, SWAPAMOUNT)
                  await hdTokenPlayer.approve(lending.address, LIQUIDITYAMOUNT)
                  await lendingPlayer.deposit(hdToken.address, LIQUIDITYAMOUNT)
                  await lending.borrow(hdToken.address, SAFEBORROW)
                  await expect(
                      lendingPlayer.liquidate(deployer, hdToken.address, usdcToken.address)
                  ).to.be.revertedWith("User Can't Be liquidated")
              })
              it("liquidates half of selected token, updates values correctly", async function () {})
          })
      })
