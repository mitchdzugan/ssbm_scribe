const http                              = require("http");
const request                           = require("request");
const { spawn, exec }                   = require("child_process");
const {
    createReadStream,
    createWriteStream,
    existsSync,
}                                       = require("fs");
const fs                                = require("fs/promises");
const { SlippiGame }                    = require("@slippi/slippi-js");
const util                              = require("util");
const config                            = require("./config.json");

const pexec = util.promisify(exec);

const dumpPath = __dirname + "\\User\\Dump\\";
const slippiExe = config.slippiExe;

const getData = (game) => {
    const settings = game.getSettings();
    const isSingles = settings.players.length === 2;
    const metadata = game.getMetadata();
    const stats = game.getStats();

    const isMe = ({ connectCode, characterId }) => {
        const code = connectCode.toLowerCase();
        return characterId === 17 && (code === "dz#788" || code === "lube#420");
    };
    const is0 = isMe(settings.players[0]);
    const is1 = isMe(settings.players[1]);
    const isDitto = (
        settings.players[0].characterId === settings.players[1].characterId
    );
    const myIndex = is0 ? 0 : 1;
    const amIn = is0 || is1;
    const isShort = metadata.lastFrame < 60 * 30;

    let skipReason = null;
    if (!amIn) {
        skipReason = "NotInOrNotYoshi";
    } else if (isShort) {
        skipReason = "isShort";
    } else if (isDitto) {
        skipReason = "isDitto"
    } else if (!isSingles) {
        skipReason = "isDoubles";
    }

    if (skipReason) {
        return { isSkip: true, skipReason };
    }

    const frames = game.getFrames();
    const { players } = frames[metadata.lastFrame];
    const winnerIndex = !stats.gameComplete ? null : (
        players[0].post.stocksRemaining === 0 ? 1 : 0
    );
    const myEndStocks   = players[is0 ? 0 : 1].post.stocksRemaining;
    const myEndPercent  = !myEndStocks  ? 0 : players[is0 ? 0 : 1].post.percent;
    const oppEndStocks  = players[is0 ? 1 : 0].post.stocksRemaining;
    const oppEndPercent = !oppEndStocks ? 0 : players[is0 ? 1 : 0].post.percent;
    const stockData = [
        [],
        [],
    ];
    stats.stocks.forEach(({ playerIndex, count, startFrame }) => {
        stockData[playerIndex].push({ startFrame, count });
    });
    stockData[0].sort((a, b) => a.count - b.count);
    stockData[1].sort((a, b) => a.count - b.count);
    const getStock = (frame) => {
        let stock = null;
        stockData[is0 ? 1 : 0].forEach(({ startFrame, count }) => {
            if (frame < startFrame || stock) { return; }
            stock = count;
        });
        return stock || 4;
    };
    const Combos = stats.conversions
        .filter(({ playerIndex }) => playerIndex !== myIndex)
        .map(({ startFrame, endFrame, startPercent, endPercent, moves, didKill, openingType }) => ({
            startPercent,
            damage: endPercent - startPercent,
            startFrame,
            frames: endFrame - startFrame,
            didKill,
            openingType,
            stock: getStock(startFrame),
            Moves: moves.map(({ moveId, damage }, nth) => (
                { nth, moveId, damage }
            )),
        }));
    return {
        isSkip: false,
        Game: {
            characterId: settings.players[is0 ? 1 : 0].characterId,
            stageId: settings.stageId,
            lastFrame: metadata.lastFrame,
            myPort: settings.players[is0 ? 0 : 1].port - 1,
            myIndex,
            oppEndStocks,
            oppEndPercent,
            myEndStocks,
            myEndPercent,
            doer: "surface",
            endResult: (
                !stats.gameComplete ? 5 : (winnerIndex === myIndex ? 1 : 0)
            )
        },
        Combos,
    };
};

const main = async () => {
    // CLEAN
    const frames = await fs.readdir(dumpPath + "Frames");
    const wavs = await fs.readdir(dumpPath + "Audio");
    for (const frame of frames) {
        await fs.unlink(dumpPath + "Frames\\" + frame);
    }
    for (const wav of wavs) {
        await fs.unlink(dumpPath + "Audio\\" + wav);
    }

    const removeIf = async (name) => {
        const hasIt = existsSync(__dirname + "\\" + name);
        if (hasIt) {
            await fs.unlink(__dirname + "\\" + name);
        }
    };
    await removeIf("todo.slp");
    await removeIf("ready.slp");
    await removeIf("final.mp4");
    await removeIf("full.avi");
    await removeIf("videoOnly.avi");

    // PREPARE
    // const slpFile = process.argv[2];
    const slpFile = createWriteStream(__dirname + "\\todo.slp");
    http.get("http://192.168.1.28:3000/api/fake", async (res) => {
        const filename = res
            .headers["content-disposition"]
            .split("filename=")[1]
            .split(".slp")[0]
            .trim();
        res.pipe(slpFile);
        await new Promise(fulfill => slpFile.on("finish", fulfill));
        const game = new SlippiGame(__dirname + "\\todo.slp");
        const settings = game.getSettings();
        const metadata = game.getMetadata();

        const isMe = ({ connectCode, characterId }) => {
            const code = connectCode.toLowerCase();
            return characterId === 17 && (code === "dz#788" || code === "lube#420");
        };
        const is0 = isMe(settings.players[0]);
        const DATA = getData(game);

        if (DATA.isSkip) {
            /**
             * TODO DELETE
            request.post({
                url: "http://192.168.1.28:3000/api/" + filename + "/reject",
                form: { skipReason: DATA.skipReason }
            }, () => {
                console.log("Requesting new in 5 seconds...");
                setTimeout(main, 5000);
            });
             *
             */
        } else {
            const myPortId = settings.players[is0 ? 0 : 1].port - 1;
            const Command = {
                MESSAGE_SIZES: 0x35,
                GAME_START: 0x36,
                PRE_FRAME_UPDATE: 0x37,
                POST_FRAME_UPDATE: 0x38,
                GAME_END: 0x39,
                ITEM_UPDATE: 0x3b,
                FRAME_BOOKEND: 0x3c,
            };
            const getMessageSizes = (buffer, position) => {
                const messageSizes = {};
                // Support old file format
                if (position === 0) {
                  messageSizes[0x36] = 0x140;
                  messageSizes[0x37] = 0x6;
                  messageSizes[0x38] = 0x46;
                  messageSizes[0x39] = 0x1;
                  return messageSizes;
                }
              
                if (buffer[position + 0] !== Command.MESSAGE_SIZES) {
                  return {};
                }
              
                const payloadLength = buffer[position + 1];
                messageSizes[0x35] = payloadLength;
              
                for (let i = 0; i < payloadLength - 1; i += 3) {
                  const command = buffer[position + i + 2];
              
                  // Get size of command
                  messageSizes[command] = (buffer[position + i + 3] << 8) | buffer[position + i + 4];
                }
              
                return messageSizes;
            }
            const getRawDataPosition = (buffer) => {
                if (buffer[0] === 0x36) {
                    return 0;
                }
                if (buffer[0] !== "{".charCodeAt(0)) {
                    return 0; // return error?
                }
                return 15;
            }
            const buffer = await fs.readFile(__dirname + "\\todo.slp");
            const rawPosition = getRawDataPosition(buffer);
            const messageSizes = getMessageSizes(buffer, rawPosition);

            let pos = rawPosition;
            let updated = false;
            while (!updated) {
                const cmd = buffer[pos];
                if (cmd === Command.GAME_START) {
                    const start = pos;
                    const offset = myPortId * 0x24;
                    buffer[0x68 + offset + start] = 0;
                    updated = true;
                }
                pos += 1 + messageSizes[buffer[pos]];
            }
            await fs.writeFile(__dirname + "\\ready.slp", buffer);
            const slippiProc = spawn(slippiExe, [
                "--user", __dirname + "\\User",
                "--cout", "--batch", 
                "--slippi-input", __dirname + "\\record.json", 
                "--exec", config.meleeIso
            ]);
            slippiProc.stdout.on("data", (data) => {
                const msg = data.toString().trim();
                if (msg.startsWith("[CURRENT_FRAME]")) {
                    const currentFrame = parseInt(msg.split("[CURRENT_FRAME]")[1].trim());
                    console.log({
                        currentFrame,
                        lastFrame: metadata.lastFrame
                    });
                    if (currentFrame === metadata.lastFrame) {
                        console.log("Spwaning...");
                        const awaitProc = spawn("python", [
                            "C:\\Users\\Mitch\\Projects\\Recording\\awaitEnd.py"
                        ]);
                        awaitProc.stdout.on("data", async (data) => {
                            if (data.toString().trim() === "DONE") {
                                slippiProc.kill();
                                awaitProc.kill();
                                console.log("vidOfFrames...");
                                await pexec(
                                    'python "C:\\Users\\Mitch\\Projects\\Recording\\vidOfFrames.py"'
                                );
                                console.log("audio...");
                                await pexec(
                                    'ffmpeg -i "C:\\Users\\Mitch\\Projects\\Recording\\videoOnly.avi" -i "C:\\Users\\Mitch\\AppData\\Roaming\\Slippi Launcher\\playback\\User\\Dump\\Audio\\dspdump.wav" -c:v copy -c:a aac "C:\\Users\\Mitch\\Projects\\Recording\\full.avi"'
                                );
                                console.log("codec...");
                                await pexec(
                                    'ffmpeg -i "C:\\Users\\Mitch\\Projects\\Recording\\full.avi" -c:a copy -c:v libx265 -b:v 12M "C:\\Users\\Mitch\\Projects\\Recording\\final.mp4"'
                                );
                                console.log("uploading...");
                                
                                /**
                                 * TODO DELETE
                                const req = request.post("http://192.168.1.28:3000/api/" + filename + "/upload", () => {
                                    console.log("Requesting new in 5 seconds...");
                                    setTimeout(main, 5000);
                                });
                                const form = req.form();
                                form.append("Game", JSON.stringify(DATA.Game));
                                form.append("Combos", JSON.stringify(DATA.Combos));
                                form.append("vod", createReadStream(__dirname + "\\final.mp4"));
                                 *
                                 */
                            }
                        });
                    }
                }
            });
        }
    });
};

main();
