const { network } = require("hardhat")
const { ethers } = require("hardhat")

const USDC_INITIAL_PRICE = ethers.utils.parseEther("0.001") // 1 DAI = $1 & ETH = $1,000
const HD_INITIAL_PRICE = ethers.utils.parseEther("0.001")
const DECIMALS = 18

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    const chainId = network.config.chainId
    // If we are on a local development network, we need to deploy mocks!
    if (chainId == 31337) {
        log("Local network detected! Deploying mocks...")
        await deploy("USDCETHPriceFeed", {
            contract: "MockV3Aggregator",
            from: deployer,
            log: true,
            args: [DECIMALS, USDC_INITIAL_PRICE],
        })
        await deploy("HDETHPriceFeed", {
            contract: "MockV3Aggregator",
            from: deployer,
            log: true,
            args: [DECIMALS, HD_INITIAL_PRICE],
        })
        log("Mocks Deployed!")
    }
}
module.exports.tags = ["all", "mocks"]
