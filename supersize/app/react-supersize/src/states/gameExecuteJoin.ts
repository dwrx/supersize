import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { ApplySystem, createDelegateInstruction, createUndelegateInstruction, FindComponentPda, FindEntityPda } from "@magicblock-labs/bolt-sdk";

import { ActiveGame } from "@utils/types";
import { fetchTokenMetadata } from "@utils/helper";

import { MagicBlockEngine } from "../engine/MagicBlockEngine";
import { gameSystemJoin } from "./gameSystemJoin";
import { gameSystemBuyIn } from "./gameSystemBuyIn";
import {
  COMPONENT_PLAYER_ID,
  COMPONENT_ANTEROOM_ID,
  COMPONENT_MAP_ID,
  COMPONENT_SECTION_ID,
  SYSTEM_SPAWN_PLAYER_ID,
  SYSTEM_BUY_IN_ID,
} from "./gamePrograms";

import * as anchor from "@coral-xyz/anchor";
import {anteroomFetchOnChain, 
  mapFetchOnChain, 
  playerFetchOnChain, 
  playerFetchOnEphem, 
  sectionFetchOnChain, 
  sectionFetchOnEphem, 
  anteroomFetchOnEphem, 
  mapFetchOnEphem} 
from "./gameFetch";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import axios from "axios";
import { getMemberPDA } from "buddy.link";

export async function gameExecuteJoin(
  engine: MagicBlockEngine,
  selectGameId: ActiveGame,
  buyIn: number,
  playerName: string
) {

  if (selectGameId.name == "loading") return;
  const gameInfo = selectGameId;
  let maxplayer = 20;
  let foodcomponents = 32;

  const mapseed = "origin";
  const mapEntityPda = FindEntityPda({
      worldId: gameInfo.worldId,
      entityId: new anchor.BN(0),
      seed: mapseed
  });

  const mapComponentPda = FindComponentPda({
      componentId: COMPONENT_MAP_ID,
      entity: mapEntityPda,
  });

  let map_size = 4000;
  const mapacc = await mapFetchOnChain(engine, mapComponentPda);
  if (mapacc) {
      map_size = mapacc.width;
  }
  if (map_size == 4000) {
      maxplayer = 20;
      foodcomponents = 16 * 5;
  }
  else if (map_size == 6000) {
      maxplayer = 40;
      foodcomponents = 36 * 5;
  }
  else if (map_size == 10000) {
      maxplayer = 100;
      foodcomponents = 100 * 5;
  }

  const foodEntityPdas: PublicKey[] = [];

  for (let i = 1; i < foodcomponents + 1; i++) {
      const foodseed = 'food' + i.toString();
      const foodEntityPda = FindEntityPda({
          worldId: gameInfo.worldId,
          entityId: new anchor.BN(0),
          seed: foodseed
      });
      foodEntityPdas.push(foodEntityPda);
  }

  const playerEntityPdas: PublicKey[] = [];
  let newplayerEntityPda: PublicKey | null = null;
  let myPlayerId = '';
  let myPlayerStatus = 'new_player';
  let need_to_undelegate = false;

  for (let i = 1; i < maxplayer + 1; i++) {
      const playerentityseed = 'player' + i.toString();
      const playerEntityPda = FindEntityPda({
          worldId: gameInfo.worldId,
          entityId: new anchor.BN(0),
          seed: playerentityseed
      });
      playerEntityPdas.push(playerEntityPda);
      const playersComponentPda = FindComponentPda({
          componentId: COMPONENT_PLAYER_ID,
          entity: playerEntityPda,
      });

      const playersacc = await engine.getChainAccountInfo(
        playersComponentPda
    );
    const playersaccER = await engine.getEphemAccountInfo(
        playersComponentPda
    );
    const playersParsedData = await playerFetchOnChain(engine, playersComponentPda);

      if (playersacc && playersParsedData) {
        if (playersacc.owner.toString() === "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh") {
              if (playersParsedData.authority !== null) {
                const playersParsedDataER = await playerFetchOnEphem(engine, playersComponentPda);
                  if (playersaccER && playersParsedDataER) {
                      if (playersParsedData.authority.toString() == engine.getSessionPayer().toString()) {
                          if (playersParsedDataER.authority) {
                              if (playersParsedDataER.authority.toString() == engine.getSessionPayer().toString()) {
                                  myPlayerStatus = "resume_session";
                                  newplayerEntityPda = playerEntityPda;
                                  myPlayerId = playerentityseed;
                                  need_to_undelegate = false;
                              } else {
                                  myPlayerStatus = "rejoin_session";
                                  newplayerEntityPda = playerEntityPda;
                                  myPlayerId = playerentityseed;
                                  need_to_undelegate = false;
                              }
                          } else {
                              myPlayerStatus = "rejoin_session";
                              newplayerEntityPda = playerEntityPda;
                              myPlayerId = playerentityseed;
                              need_to_undelegate = false;
                          }
                      } else {
                          if (playersParsedDataER.authority == null &&
                              playersParsedData.authority !== null &&
                              playersParsedDataER.x == 50000 &&
                              playersParsedDataER.y == 50000 &&
                              playersParsedDataER.score == 0 &&
                              newplayerEntityPda == null
                          ) {
                              const startTime = playersParsedDataER.joinTime.toNumber() * 1000;
                              const currentTime = Date.now();
                              const elapsedTime = currentTime - startTime;
                              if (elapsedTime >= 10000) {
                                  newplayerEntityPda = playerEntityPda;
                                  myPlayerId = playerentityseed;
                                  need_to_undelegate = true;
                              }
                          }
                      }
                  } else if (playersParsedData.authority !== null) {
                      if (playersParsedData.authority.toString() == engine.getSessionPayer().toString()) {
                          myPlayerStatus = "rejoin_session";
                          newplayerEntityPda = playerEntityPda;
                          myPlayerId = playerentityseed;
                          need_to_undelegate = false;
                      }
                  }
              }
          } else if (playersParsedData.authority == null && newplayerEntityPda == null) {
              newplayerEntityPda = playerEntityPda;
              myPlayerId = playerentityseed;
              need_to_undelegate = false;
          } else {
              if (playersParsedData.authority !== null) {
                  if (playersParsedData.authority.toString() == engine.getSessionPayer().toString()) {
                      myPlayerStatus = "rejoin_undelegated";
                      newplayerEntityPda = playerEntityPda;
                      myPlayerId = playerentityseed;
                      need_to_undelegate = false;
                  }
              }
          }
      } else {
          if (newplayerEntityPda == null) {
              newplayerEntityPda = playerEntityPda;
              myPlayerId = playerentityseed;
              need_to_undelegate = false;
          }
      }
  }

  console.log('my player', myPlayerId, myPlayerStatus);

  if (!newplayerEntityPda) {
      //setTransactionError("No available player slots");
      //setIsJoining(false);
      return;
  }

  const playerComponentPda = FindComponentPda({
      componentId: COMPONENT_PLAYER_ID,
      entity: newplayerEntityPda,
  });
  console.log('component pda', playerComponentPda.toString());

  if (need_to_undelegate) {
      try {
          const undelegateIx = createUndelegateInstruction({
              payer: engine.getSessionPayer(),
              delegatedAccount: playerComponentPda,
              componentPda: COMPONENT_PLAYER_ID,
          });
          let undeltx = new anchor.web3.Transaction().add(undelegateIx);
          undeltx.recentBlockhash = (await engine.getConnectionEphem().getLatestBlockhash()).blockhash;
          undeltx.feePayer = engine.getSessionPayer();
          const playerundelsignature = await engine.processSessionEphemTransaction("undelPlayer:" + playerComponentPda.toString(), undeltx); //providerEphemeralRollup.current.sendAndConfirm(undeltx, [], { skipPreflight: false });
          console.log('undelegate', playerundelsignature);
      } catch (error) {
          console.log('Error undelegating:', error);
      }
  }

  const anteseed = "ante";
  const anteEntityPda = FindEntityPda({
      worldId: gameInfo.worldId,
      entityId: new anchor.BN(0),
      seed: anteseed
  });

  const anteComponentPda = FindComponentPda({
      componentId: COMPONENT_ANTEROOM_ID,
      entity: anteEntityPda,
  });

  const anteParsedData = await anteroomFetchOnChain(engine, anteComponentPda);

  if (anteParsedData && anteParsedData.vaultTokenAccount && anteParsedData.token) {
      let mint_of_token_being_sent = anteParsedData.token;

      const { name, image } = await fetchTokenMetadata(mint_of_token_being_sent.toString());
      console.log("token", name, mint_of_token_being_sent.toString());

      try {
          let response = await axios.post("https://supersize.lewisarnsten.workers.dev/create-contest", {
              name: name,
              tokenAddress: mint_of_token_being_sent.toString()
          });
          console.log(response);
      } catch (error) {
          console.log('error', error);
      }

      try {
          let username = engine.getWalletPayer().toString();
          if (mint_of_token_being_sent.toString() != "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
              username = engine.getWalletPayer().toString() + "_" + name;
          }
          let response = await axios.post("https://supersize.lewisarnsten.workers.dev/create-user", {
              walletAddress: engine.getWalletPayer().toString(),
              name: username,
              contestId: name,
          });
          console.log(response);
      } catch (error) {
          console.log('error', error);
      }
  } else {
      return;
  }

  await gameSystemBuyIn(engine, selectGameId,newplayerEntityPda, anteEntityPda, myPlayerStatus, buyIn);
  return await gameSystemJoin(engine, selectGameId, newplayerEntityPda, mapEntityPda, playerName);
}
