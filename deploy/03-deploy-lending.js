const { network, getNamedAccounts, deployments } = require("hardhat")
const { developmentChains } = require("../helper-hardhat-config")
const { verify } = require("../utils/verify")

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()

    log("-------------------------------------")

    const args = []
    const lendingDeployment = await deploy("Lending", {
        from: deployer,
        args: args,
        log: true,
        waitConfirmations: network.config.blockConfirmations || 1,
    })

    if (!developmentChains.includes(network.name) && process.env.ETHERSCAN_API_KEY) {
        log("Verifying...")
        await verify(lending.address, args)
    }

    const lending = await ethers.getContract("Lending")
    if (network.config.chainId == "31337") {
        const usdc = await ethers.getContract("UsdcToken")
        const hd = await ethers.getContract("HdToken")
        const usdcEthPriceFeed = await ethers.getContract("USDCETHPriceFeed")
        const hdEthPriceFeed = await ethers.getContract("HDETHPriceFeed")
        await lending.setApprovedToken(usdc.address, usdcEthPriceFeed.address)
        await lending.setApprovedToken(hd.address, hdEthPriceFeed.address)
    } else {
        await lending.setApprovedToken(
            networkConfig[network.config.chainId]["usdc"],
            networkConfig[network.config.chainId]["usdcEthPriceFeed"]
        )
        await lending.setApprovedToken(
            networkConfig[network.config.chainId]["hd"],
            networkConfig[network.config.chainId]["hdEthPriceFeed"]
        )
    }
    log("-------------------------------------")
}

module.exports.tags = ["all", "lending"]
