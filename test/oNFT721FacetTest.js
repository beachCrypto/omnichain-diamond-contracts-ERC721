/* global ethers describe before it */
/* eslint-disable prefer-const */

const {deployDiamondA} = require('../scripts/deployA.js');
const {deployDiamondB} = require('../scripts/deployB.js');
const {offsettedIndex} = require('./helpers/helpers.js');

const {assert, expect} = require('chai');

const {ethers} = require('hardhat');

let offsetted;

describe('sendFrom()', async () => {
    // Diamond contracts
    let diamondAddressA;
    let diamondAddressB;
    let eRC721A_chainA;
    let eRC721A_chainB;
    let mintFacet_chainA;
    let mintFacet_chainB;
    let NonblockingLzAppUpgradeableA;
    let NonblockingLzAppUpgradeableB;
    let owner;

    const defaultAdapterParams = ethers.utils.solidityPack(['uint16', 'uint256'], [1, 200000]);

    // Layer Zero
    const chainId_A = 1;
    const chainId_B = 2;
    const name = 'OmnichainNonFungibleToken';
    const symbol = 'ONFT';

    before(async function () {
        LZEndpointMockA = await ethers.getContractFactory('LZEndpointMockA');
        LZEndpointMockB = await ethers.getContractFactory('LZEndpointMockB');
    });

    beforeEach(async () => {
        lzEndpointMockA = await LZEndpointMockA.deploy(chainId_A);
        lzEndpointMockB = await LZEndpointMockB.deploy(chainId_B);

        // generate a proxy to allow it to go ONFT
        diamondAddressA = await deployDiamondA();
        diamondAddressB = await deployDiamondB();

        eRC721A_chainA = await ethers.getContractAt('ERC721AUpgradeable', diamondAddressA);
        eRC721A_chainB = await ethers.getContractAt('ERC721AUpgradeable', diamondAddressB);

        mintFacet_chainA = await ethers.getContractAt('MintFacet', diamondAddressA);
        mintFacet_chainB = await ethers.getContractAt('MintFacet', diamondAddressB);

        // wire the lz endpoints to guide msgs back and forth
        lzEndpointMockA.setDestLzEndpoint(diamondAddressB.address, lzEndpointMockB.address);
        lzEndpointMockB.setDestLzEndpoint(diamondAddressA.address, lzEndpointMockA.address);

        // set each contracts source address so it can send to each other
        await eRC721A_chainA.setTrustedRemote(
            chainId_B,
            ethers.utils.solidityPack(['address', 'address'], [diamondAddressB, diamondAddressA])
        );

        await eRC721A_chainB.setTrustedRemote(
            chainId_A,
            ethers.utils.solidityPack(['address', 'address'], [diamondAddressA, diamondAddressB])
        );

        await eRC721A_chainA.setMinDstGas(chainId_B, 1, 150000);
        await eRC721A_chainB.setMinDstGas(chainId_A, 1, 150000);

        const [owner, addr1] = await ethers.getSigners();

        ownerAddress = owner;
        warlock = addr1;

        console.log('ownerAddress', ownerAddress.address);
        console.log('warlock', warlock.address);
    });

    it('sendFrom() - your own tokens', async () => {
        let tokenId = 1;
        await mintFacet_chainA.mint(2);

        // verify the owner of the token is on the source chain
        expect(await eRC721A_chainA.ownerOf(0)).to.be.equal(ownerAddress.address);
        expect(await eRC721A_chainA.ownerOf(1)).to.be.equal(ownerAddress.address);

        // token doesn't exist on other chain
        await expect(eRC721A_chainB.ownerOf(tokenId)).to.be.revertedWith('OwnerQueryForNonexistentToken');

        // can transfer token on srcChain as regular erC721
        await eRC721A_chainA.transferFrom(ownerAddress.address, warlock.address, tokenId);
        expect(await eRC721A_chainA.ownerOf(tokenId)).to.be.equal(warlock.address);

        // approve the contract to swap your token
        await eRC721A_chainA.connect(warlock).approve(eRC721A_chainA.address, tokenId);

        // estimate nativeFees
        let nativeFee = (
            await eRC721A_chainA.estimateSendFee(chainId_B, ownerAddress.address, tokenId, false, defaultAdapterParams)
        ).nativeFee;

        // swaps token to other chain
        await eRC721A_chainA
            .connect(warlock)
            .sendFrom(
                warlock.address,
                chainId_B,
                warlock.address,
                tokenId,
                warlock.address,
                ethers.constants.AddressZero,
                defaultAdapterParams,
                {value: nativeFee}
            );

        // token is burnt
        eexpect(await eRC721A_chainA.ownerOf(0)).to.be.equal(eRC721A_chainA.address);
        expect(await eRC721A_chainA.ownerOf(tokenId)).to.be.equal(eRC721A_chainA.address);

        // token received on the dst chain
        expect(await eRC721A_chainB.ownerOf(tokenId)).to.be.equal(warlock.address);

        // // estimate nativeFees

        // nativeFee = (
        //     await eRC721A_chainB.estimateSendFee(chainId_A, warlock.address, tokenId, false, defaultAdapterParams)
        // ).nativeFee;

        // // can send to other onft contract eg. not the original nft contract chain
        // await eRC721A_chainB
        //     .connect(warlock)
        //     .sendFrom(
        //         warlock.address,
        //         chainId_A,
        //         warlock.address,
        //         tokenId,
        //         warlock.address,
        //         ethers.constants.AddressZero,
        //         '0x',
        //         {value: nativeFee}
        //     );

        // // token is burned on the sending chain
        // expect(await eRC721A_chainB.ownerOf(tokenId)).to.be.equal(eRC721A_chainB.address);
    });

    // it('sendFrom() - reverts if not owner on non proxy chain', async function () {
    //     const tokenId = 0;
    //     await mintFacet_chainA.mint(1);

    //     // approve the proxy to swap your token
    //     await eRC721A_chainA.approve(eRC721A_chainA.address, tokenId);

    //     // estimate nativeFees
    //     let nativeFee = (await eRC721A_chainA.estimateSendFee(chainId_B, ownerAddress.address, tokenId, false, '0x'))
    //         .nativeFee;

    //     // swaps token to other chain
    //     await eRC721A_chainA.sendFrom(
    //         ownerAddress.address,
    //         chainId_B,
    //         ownerAddress.address,
    //         tokenId,
    //         ownerAddress.address,
    //         ethers.constants.AddressZero,
    //         '0x',
    //         {
    //             value: nativeFee,
    //         }
    //     );

    //     // token received on the dst chain
    //     expect(await eRC721A_chainB.ownerOf(tokenId)).to.be.equal(ownerAddress.address);

    //     // reverts because other address does not own it
    //     await expect(
    //         eRC721A_chainB
    //             .connect(warlock)
    //             .sendFrom(
    //                 warlock.address,
    //                 chainId_A,
    //                 warlock.address,
    //                 tokenId,
    //                 warlock.address,
    //                 ethers.constants.AddressZero,
    //                 '0x'
    //             )
    //     ).to.be.revertedWith('ONFT721: send caller is not owner nor approved');
    // });

    // it('sendFrom() - on behalf of other user', async function () {
    //     const tokenId = 0;
    //     await mintFacet_chainA.mint(1);

    //     // approve the proxy to swap your token
    //     await eRC721A_chainA.approve(eRC721A_chainA.address, tokenId);

    //     // estimate nativeFees
    //     let nativeFee = (await eRC721A_chainA.estimateSendFee(chainId_B, ownerAddress.address, tokenId, false, '0x'))
    //         .nativeFee;

    //     // swaps token to other chain
    //     await eRC721A_chainA.sendFrom(
    //         ownerAddress.address,
    //         chainId_B,
    //         ownerAddress.address,
    //         tokenId,
    //         ownerAddress.address,
    //         ethers.constants.AddressZero,
    //         '0x',
    //         {
    //             value: nativeFee,
    //         }
    //     );

    //     // token received on the dst chain
    //     expect(await eRC721A_chainB.ownerOf(tokenId)).to.be.equal(ownerAddress.address);

    //     // approve the other user to send the token
    //     await eRC721A_chainB.approve(warlock.address, tokenId);

    //     // estimate nativeFees
    //     nativeFee = (await eRC721A_chainB.estimateSendFee(chainId_A, ownerAddress.address, tokenId, false, '0x'))
    //         .nativeFee;

    //     // sends across
    //     await eRC721A_chainB
    //         .connect(warlock)
    //         .sendFrom(
    //             ownerAddress.address,
    //             chainId_A,
    //             warlock.address,
    //             tokenId,
    //             warlock.address,
    //             ethers.constants.AddressZero,
    //             '0x',
    //             {value: nativeFee}
    //         );

    //     // token received on the dst chain
    //     expect(await eRC721A_chainA.ownerOf(tokenId)).to.be.equal(warlock.address);
    // });

    // it('sendFrom() - reverts if contract is approved, but not the sending user', async function () {
    //     const tokenId = 0;
    //     await mintFacet_chainA.connect(ownerAddress).mint(1);

    //     // approve the proxy to swap your token
    //     await eRC721A_chainA.approve(eRC721A_chainA.address, tokenId);

    //     // estimate nativeFees
    //     let nativeFee = (await eRC721A_chainA.estimateSendFee(chainId_B, ownerAddress.address, tokenId, false, '0x'))
    //         .nativeFee;

    //     // swaps token to other chain
    //     await eRC721A_chainA.sendFrom(
    //         ownerAddress.address,
    //         chainId_B,
    //         ownerAddress.address,
    //         tokenId,
    //         ownerAddress.address,
    //         ethers.constants.AddressZero,
    //         '0x',
    //         {
    //             value: nativeFee,
    //         }
    //     );

    //     // token received on the dst chain
    //     expect(await eRC721A_chainB.ownerOf(tokenId)).to.be.equal(ownerAddress.address);

    //     // approve the contract to swap your token
    //     await eRC721A_chainB.approve(eRC721A_chainB.address, tokenId);

    //     // reverts because contract is approved, not the user
    //     await expect(
    //         eRC721A_chainB
    //             .connect(warlock)
    //             .sendFrom(
    //                 ownerAddress.address,
    //                 chainId_A,
    //                 warlock.address,
    //                 tokenId,
    //                 warlock.address,
    //                 ethers.constants.AddressZero,
    //                 '0x'
    //             )
    //     ).to.be.revertedWith('ONFT721: send caller is not owner nor approved');
    // });

    // it('sendFrom() - reverts if not approved on non proxy chain', async function () {
    //     const tokenId = 0;
    //     await mintFacet_chainA.connect(ownerAddress).mint(1);

    //     // approve the proxy to swap your token
    //     await eRC721A_chainA.approve(eRC721A_chainA.address, tokenId);

    //     // estimate nativeFees
    //     let nativeFee = (await eRC721A_chainA.estimateSendFee(chainId_B, ownerAddress.address, tokenId, false, '0x'))
    //         .nativeFee;

    //     // swaps token to other chain
    //     await eRC721A_chainA.sendFrom(
    //         ownerAddress.address,
    //         chainId_B,
    //         ownerAddress.address,
    //         tokenId,
    //         ownerAddress.address,
    //         ethers.constants.AddressZero,
    //         '0x',
    //         {
    //             value: nativeFee,
    //         }
    //     );

    //     // token received on the dst chain
    //     expect(await eRC721A_chainB.ownerOf(tokenId)).to.be.equal(ownerAddress.address);

    //     // reverts because user is not approved
    //     await expect(
    //         eRC721A_chainB
    //             .connect(warlock)
    //             .sendFrom(
    //                 ownerAddress.address,
    //                 chainId_A,
    //                 warlock.address,
    //                 tokenId,
    //                 warlock.address,
    //                 ethers.constants.AddressZero,
    //                 '0x'
    //             )
    //     ).to.be.revertedWith('ONFT721: send caller is not owner nor approved');
    // });

    // it('sendFrom() - reverts if sender does not own token', async function () {
    //     const tokenIdA = 0;
    //     const tokenIdB = 334;
    //     // mint to both owners
    //     await mintFacet_chainA.connect(ownerAddress).mint(1);

    //     await mintFacet_chainA.connect(warlock).mint(1);

    //     // approve ownerAddress.address to transfer, but not the other
    //     await eRC721A_chainA.setApprovalForAll(eRC721A_chainA.address, true);

    //     await expect(
    //         eRC721A_chainA
    //             .connect(warlock)
    //             .sendFrom(
    //                 warlock.address,
    //                 chainId_B,
    //                 warlock.address,
    //                 tokenIdA,
    //                 warlock.address,
    //                 ethers.constants.AddressZero,
    //                 '0x'
    //             )
    //     ).to.be.revertedWith('ONFT721: send caller is not owner nor approved');
    //     await expect(
    //         eRC721A_chainA
    //             .connect(warlock)
    //             .sendFrom(
    //                 warlock.address,
    //                 chainId_B,
    //                 ownerAddress.address,
    //                 tokenIdA,
    //                 ownerAddress.address,
    //                 ethers.constants.AddressZero,
    //                 '0x'
    //             )
    //     ).to.be.revertedWith('ONFT721: send caller is not owner nor approved');
    // });
});
