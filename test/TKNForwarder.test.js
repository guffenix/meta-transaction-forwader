const { expect } = require('chai')
const { ethers, upgrades } = require('hardhat')

const initialSupply = 1000000
const tokenName = 'VirtualitoTKN'
const tokenSymbol = 'VTN'

const eip712DomainTypeDefinition = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
]

const metaTxTypeDefinition = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'data', type: 'bytes' },
]

function getTypedData(typedDataInput) {
  return {
    types: {
      EIP712Domain: eip712DomainTypeDefinition,
      [typedDataInput.primaryType]: metaTxTypeDefinition,
    },
    primaryType: typedDataInput.primaryType,
    domain: typedDataInput.domainValues,
    message: typedDataInput.messageValues,
  }
}

describe('VirtualitoTKN token set tests', function () {
  let virtualitoTKNV1
  let virtualitoTKNV2
  let virtualitoTKNV3
  let tknForwarder
  let deployer
  let userAccount
  let receiverAccount
  let relayerAccount

  describe('First version of VirtualitoTKN tests', function () {
    before(async function () {
      const availableSigners = await ethers.getSigners()
      deployer = availableSigners[0]

      const VirtualitoTKN = await ethers.getContractFactory('VirtualitoTKN')

      // this.virtualitoTKNV1 = await VirtualitoTKN.deploy(initialSupply);
      virtualitoTKNV1 = await upgrades.deployProxy(
        VirtualitoTKN,
        [initialSupply],
        {
          kind: 'uups',
        },
      )
      await virtualitoTKNV1.deployed()
    })

    it('Should be named VirtualitoTKN', async function () {
      const fetchedTokenName = await virtualitoTKNV1.name()
      expect(fetchedTokenName).to.be.equal(tokenName)
    })

    it('Should have symbol "VTN"', async function () {
      const fetchedTokenSymbol = await virtualitoTKNV1.symbol()
      expect(fetchedTokenSymbol).to.be.equal(tokenSymbol)
    })

    it('Should have totalSupply passed in during deployment', async function () {
      const [fetchedTotalSupply, decimals] = await Promise.all([
        virtualitoTKNV1.totalSupply(),
        virtualitoTKNV1.decimals(),
      ])
      const expectedTotalSupply = ethers.BigNumber.from(initialSupply).mul(
        ethers.BigNumber.from(10).pow(decimals),
      )
      expect(fetchedTotalSupply.eq(expectedTotalSupply)).to.be.true
    })
  })

  describe('Second version of VirtualitoTKN tests', function () {
    before(async function () {
      userAccount = (await ethers.getSigners())[1]

      const VirtualitoTKNV2 = await ethers.getContractFactory('VirtualitoTKNV2')

      virtualitoTKNV2 = await upgrades.upgradeProxy(
        virtualitoTKNV1.address,
        VirtualitoTKNV2,
      )

      await virtualitoTKNV2.deployed()
    })

    it('Should revert when an account other than the owner is trying to mint tokens', async function () {
      const tmpContractRef = await virtualitoTKNV2.connect(userAccount)
      try {
        await tmpContractRef.mint(
          userAccount.address,
          ethers.BigNumber.from(10).pow(ethers.BigNumber.from(18)),
        )
      } catch (ex) {
        expect(ex.message).to.contain('reverted')
        expect(ex.message).to.contain('Ownable: caller is not the owner')
      }
    })

    it('Should mint tokens when the owner is executing the mint function', async function () {
      const amountToMint = ethers.BigNumber.from(10)
        .pow(ethers.BigNumber.from(18))
        .mul(ethers.BigNumber.from(10))
      const accountAmountBeforeMint = await virtualitoTKNV2.balanceOf(
        deployer.address,
      )
      const totalSupplyBeforeMint = await virtualitoTKNV2.totalSupply()
      await virtualitoTKNV2.mint(deployer.address, amountToMint)

      const newAccountAmount = await virtualitoTKNV2.balanceOf(deployer.address)
      const newTotalSupply = await virtualitoTKNV2.totalSupply()

      expect(newAccountAmount.eq(accountAmountBeforeMint.add(amountToMint))).to
        .be.true
      expect(newTotalSupply.eq(totalSupplyBeforeMint.add(amountToMint))).to.be
        .true
    })
  })

  describe('Second version of VirtualitoTKN tests - Support to Meta-transactions', function () {
    before(async function () {
      const availableSigners = await ethers.getSigners()
      deployer = availableSigners[0]
      // user account
      userAccount = availableSigners[1]
      // account that will receive the tokens
      receiverAccount = availableSigners[2]
      // account that will act as gas relayer
      relayerAccount = availableSigners[3]

      const VirtualitoTKNV3 = await ethers.getContractFactory('VirtualitoTKNV3')
      const TKNForwarder = await ethers.getContractFactory('TKNForwarder')

      // deploying forwarder
      tknForwarder = await TKNForwarder.deploy()
      await tknForwarder.deployed()

      // Deploying token
      virtualitoTKNV3 = await upgrades.deployProxy(
        VirtualitoTKNV3,
        [initialSupply, tknForwarder.address],
        { kind: 'uups' },
      )
      await virtualitoTKNV3.deployed()
    })

    describe('Transfer tokens from account A to B without account A paying for gas fees', function () {
      // parameters
      let userAccountAEthersBeforeTx
      let relayerAccountEthersBeforeTx
      let relayerTokensBeforeTx

      let userAccountAEthersAfterTx
      let relayerAccountEthersAfterTx
      let relayerTokensAfterTx
      let userAccountBtokens

      let totalAmountToTransfer

      before(async function () {
        // using relayer as the transaction sender when executing contract functions
        const forwarderContractTmpInstance = await tknForwarder.connect(
          relayerAccount,
        )

        const { chainId } = await relayerAccount.provider.getNetwork()
        const userAccountA = deployer
        const userAccountB = receiverAccount

        // Getting "user" and relayer ETH balance before transaction
        userAccountAEthersBeforeTx = await userAccountA.getBalance()
        relayerAccountEthersBeforeTx = await relayerAccount.getBalance()

        // Getting relayer token balance
        relayerTokensBeforeTx = await virtualitoTKNV3.balanceOf(
          relayerAccount.address,
        )

        // Getting actual user nonce
        const userACurrentNonce = await tknForwarder.getNonce(
          userAccountA.address,
        )

        totalAmountToTransfer = ethers.BigNumber.from(1).mul(
          ethers.BigNumber.from(10).pow(10),
        )

        // Meta transaction values
        const messageValues = {
          from: userAccountA.address, //Using user address
          to: virtualitoTKNV3.address, // to token contract address
          nonce: userACurrentNonce.toString(), // actual nonce for user
          data: virtualitoTKNV3.interface.encodeFunctionData('transfer', [
            userAccountB.address,
            totalAmountToTransfer,
          ]), // encoding function call for "transfer(address _to, uint256 amount)"
        }

        // Gettting typed Data so our Meta-Tx structura can be signed
        const typedData = getTypedData({
          domainValues: {
            name: 'TKNForwarder',
            version: '0.0.1',
            chainId: chainId,
            verifyingContract: tknForwarder.address,
          },
          primaryType: 'MetaTx',
          messageValues,
        })

        // Getting signature for Meta-Tx struct using user keys
        const signedMessage = await ethers.provider.send(
          'eth_signTypedData_v4',
          [userAccountA.address, typedData],
        )

        // executing transaction
        await forwarderContractTmpInstance.executeFunction(
          messageValues,
          signedMessage,
        )

        // Getting user and relayer ETH balance before transaction
        userAccountAEthersAfterTx = await userAccountA.getBalance()
        relayerAccountEthersAfterTx = await relayerAccount.getBalance()

        // Getting user token balance after transaction
        relayerTokensAfterTx = await virtualitoTKNV3.balanceOf(
          relayerAccount.address,
        )

        // Getting receiver token balance
        userAccountBtokens = await virtualitoTKNV3.balanceOf(
          userAccountB.address,
        )
      })
      it('Should be sure the receiver got the transferred balance', async function () {
        // Making sure the receiver got the transferred balance
        expect(userAccountBtokens.eq(totalAmountToTransfer)).to.be.true
      })

      it('Should be sure the "user" ETH balance is the same as it was before sending the transaction (it did not have to pay for the transaction fee)', async function () {
        // Making sure the "user" ETH balance is the same as it was before sending the transaction (it did not have to pay for the transaction fee)
        expect(userAccountAEthersBeforeTx.eq(userAccountAEthersAfterTx)).to.be
          .true
      })

      it('Should be sure the relayer ETH balance decreased because it paid for the transaction fee', async function () {
        // Making sure the relayer ETH balance decreased because it paid for the transaction fee
        expect(relayerAccountEthersAfterTx.lt(relayerAccountEthersBeforeTx)).to
          .be.true
      })

      it('Should be sure the relayer token balance did not change', async function () {
        // Making sure the relayer token balance did not change
        expect(relayerTokensAfterTx.eq(relayerTokensBeforeTx))
      })

      it('Should be FALSE relayer tokens after tx', async function () {
        expect(relayerTokensAfterTx.eq(0)).to.be.equal(true)
      })

      it('Should be FALSE relayer tokens before tx ', async function () {
        expect(relayerTokensBeforeTx.eq(0)).to.be.equal(true)
      })
    })
  })
})
