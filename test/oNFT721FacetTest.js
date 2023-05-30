/* global ethers describe before it */
/* eslint-disable prefer-const */

const {deployERC721ADiamondA} = require('../scripts/deployERC721A_a.js');
const {deployERC721DiamondB} = require('../scripts/deployERC721_b.js');
const {offsettedIndex} = require('./helpers/helpers.js');

const {assert, expect} = require('chai');

const {ethers} = require('hardhat');

let offsetted;

describe('sendFrom()', async () => {
    // Diamond contracts
    let diamondAddressA;
    let diamondAddressB;
    let eRC721A_chainA;
    let eRC721_chainB;
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
        diamondAddressA = await deployERC721ADiamondA();
        diamondAddressB = await deployERC721DiamondB();

        eRC721A_chainA = await ethers.getContractAt('ERC721AUpgradeable', diamondAddressA);
        eRC721_chainB = await ethers.getContractAt('ERC721', diamondAddressB);

        mintFacet_chainA = await ethers.getContractAt('MintFacet', diamondAddressA);
        mintFacet_chainB = await ethers.getContractAt('MintFacet', diamondAddressB);

        NonblockingLzAppUpgradeableA = await ethers.getContractAt('NonblockingLzAppUpgradeable', diamondAddressA);
        NonblockingLzAppUpgradeableB = await ethers.getContractAt('NonblockingLzAppUpgradeable', diamondAddressB);

        // wire the lz endpoints to guide msgs back and forth
        lzEndpointMockA.setDestLzEndpoint(diamondAddressB.address, lzEndpointMockB.address);
        lzEndpointMockB.setDestLzEndpoint(diamondAddressA.address, lzEndpointMockA.address);

        // set each contracts source address so it can send to each other
        await NonblockingLzAppUpgradeableA.setTrustedRemote(
            chainId_B,
            ethers.utils.solidityPack(['address', 'address'], [diamondAddressB, diamondAddressA])
        );

        await NonblockingLzAppUpgradeableB.setTrustedRemote(
            chainId_A,
            ethers.utils.solidityPack(['address', 'address'], [diamondAddressA, diamondAddressB])
        );

        await eRC721A_chainA.setMinDstGas(chainId_B, 1, 150000);
        await eRC721_chainB.setMinDstGas(chainId_A, 1, 150000);

        const [owner, addr1] = await ethers.getSigners();

        ownerAddress = owner;
        warlock = addr1;
    });

    it('sendFrom() - your own tokens', async () => {
        let tokenId = 1;
        await mintFacet_chainA.mint(2);

        // verify the owner of the token is on the source chain
        expect(await eRC721A_chainA.ownerOf(0)).to.be.equal(ownerAddress.address);
        expect(await eRC721A_chainA.ownerOf(1)).to.be.equal(ownerAddress.address);

        // token doesn't exist on other chain
        await expect(eRC721_chainB.ownerOf(tokenId)).to.be.revertedWith('ERC721: invalid token ID');

        // can transfer token on srcChain as regular erC721A
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
        expect(await eRC721A_chainA.ownerOf(0)).to.be.equal(ownerAddress.address);
        expect(await eRC721A_chainA.ownerOf(tokenId)).to.be.equal(eRC721A_chainA.address);

        // token received on the dst chain
        expect(await eRC721_chainB.ownerOf(tokenId)).to.be.equal(warlock.address);
    });

    // it('sendFrom() - reverts if not owner on non proxy chain', async function () {
    //     const tokenId = 0;
    //     await mintFacet_chainA.mint();

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
    //     expect(await eRC721_chainB.ownerOf(tokenId)).to.be.equal(ownerAddress.address);

    //     // reverts because other address does not own it
    //     await expect(
    //         eRC721_chainB
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
    //     await mintFacet_chainA.mint();

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
    //     expect(await eRC721_chainB.ownerOf(tokenId)).to.be.equal(ownerAddress.address);

    //     // approve the other user to send the token
    //     await eRC721_chainB.approve(warlock.address, tokenId);

    //     // estimate nativeFees
    //     nativeFee = (await eRC721_chainB.estimateSendFee(chainId_A, ownerAddress.address, tokenId, false, '0x'))
    //         .nativeFee;

    //     // sends across
    //     await eRC721_chainB
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
    //     await mintFacet_chainA.connect(ownerAddress).mint();

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
    //     expect(await eRC721_chainB.ownerOf(tokenId)).to.be.equal(ownerAddress.address);

    //     // approve the contract to swap your token
    //     await eRC721_chainB.approve(eRC721_chainB.address, tokenId);

    //     // reverts because contract is approved, not the user
    //     await expect(
    //         eRC721_chainB
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
    //     await mintFacet_chainA.connect(ownerAddress).mint();

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
    //     expect(await eRC721_chainB.ownerOf(tokenId)).to.be.equal(ownerAddress.address);

    //     // reverts because user is not approved
    //     await expect(
    //         eRC721_chainB
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
    //     await mintFacet_chainA.connect(ownerAddress).mint();

    //     await mintFacet_chainA.connect(warlock).mint();

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
