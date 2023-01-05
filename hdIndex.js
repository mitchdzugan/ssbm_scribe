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

const IP = "192.168.1.17";

const getGame = (path) => {
    const game = new SlippiGame(__dirname + "\\todo.slp");
    const settings = game.getSettings();
    const metadata = game.getMetadata();
    game.isMe = (n) => {
        const characterId = (((settings || {}).players || [])[n] || {}).characterId;
        const codeA = ((((settings || {}).players || [])[n] || {}).connectCode || "").toLowerCase();
        const codeB = (((((metadata || {}).players || [])[n] || {}).names || {}).code || "").toLowerCase();
        return (characterId === 17 || characterId === 20) && (
            codeA === "dz#788"   || 
            codeA === "sion#430" ||
            codeA === "katy#377" ||
            codeA === "lube#420" ||
            codeB === "dz#788"   || 
            codeB === "sion#430" || 
            codeB === "katy#377" || 
            codeB === "lube#420" ||
            true
        );
    };
    return game;
};

const getData = (game) => {
    const settings = game.getSettings();
    const isSingles = settings.players.length === 2;
    const metadata = game.getMetadata();
	const mLastFrame = (metadata || {}).lastFrame;
	const cLastFrame = Math.max(...Object.keys(game.getFrames()).map(s => parseInt(s, 10)));
	const lastFrame = mLastFrame || cLastFrame;
	const stats = game.getStats();

    const is0 = game.isMe(0);
    const is1 = game.isMe(1);
    const isDitto = (
        settings.players[0].characterId === settings.players[1].characterId
    );
    const characterId = settings.players[is0 ? 1 : 0].characterId;
    const stageId = settings.stageId;
    const myIndex = is0 ? 0 : 1;
    const amIn = is0 || is1;
    const isShort = lastFrame < 60 * 30;

    let skipReason = null;
    if (!amIn) {
        skipReason = "NotInOrNotYoshi";
    } else if (isShort) {
        skipReason = "isShort";
    // } else if (isDitto) {
    //     skipReason = "isDitto"
    } else if (!isSingles) {
        skipReason = "isDoubles";
    } else if (characterId > 25) {
        skipReason = "invalidCharacter";
    } else if (stageId < 2 || stageId > 32 || stageId === 21) {
        skipReason = "invalidStage";
    }

    if (skipReason) {
        return { isSkip: true, skipReason };
    }

    const frames = game.getFrames();
    let i = lastFrame;
    let index0 = 0;
    let index1 = 1;
    let setIndex0 = false;
    let index = 0;
    const sframe = frames[0]
    while (index < 4) {
        if (sframe.players[index]) {
            if (setIndex0) {
                index1 = index;
                break;
            } else {
                index0 = index;
                setIndex0 = true;
            }
        }
        index++;
    }
    while (!frames[i].players[index0].post) { console.log(i); i--; }
    const { players } = frames[i];
    const winnerIndex = !stats.gameComplete ? null : (
        players[index0].post.stocksRemaining === 0 ? 1 : 0
    );
    const myEndStocks   = players[is0 ? index0 : index1].post.stocksRemaining;
    const myEndPercent  = !myEndStocks  ? 0 : players[is0 ? index0 : index1].post.percent;
    const oppEndStocks  = players[is0 ? index1 : index0].post.stocksRemaining;
    const oppEndPercent = !oppEndStocks ? 0 : players[is0 ? index1 : index0].post.percent;
    const stockData = [
        [],
        [],
        [],
        [],
    ];
    stats.stocks.forEach(({ playerIndex, count, startFrame }) => {
        stockData[playerIndex].push({ startFrame, count });
    });
    stockData[index0].sort((a, b) => a.count - b.count);
    stockData[index1].sort((a, b) => a.count - b.count);
    const getStock = (frame) => {
        let stock = null;
        stockData[is0 ? index1 : index0].forEach(({ startFrame, count }) => {
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
            characterId,
            stageId,
            lastFrame,
            myPort: settings.players[is0 ? 0 : 1].port - 1,
            myIndex,
            oppEndStocks,
            oppEndPercent,
            myEndStocks,
            myEndPercent,
            doer: config.doer,
            endResult: (
                !stats.gameComplete ? 5 : (winnerIndex === myIndex ? 1 : 0)
            )
        },
        Combos,
    };
};

const main = async () => {
    // CLEAN
    const recordJson = await fs.readFile(__dirname + "\\_record.json");
    await fs.writeFile(
        __dirname + "\\record.json",
        recordJson.toString(encoding = "utf8").replace(
            "__dirname", 
            __dirname.replace(/\\/g, "\\\\")
        )
    );
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
    await removeIf("preview.mp4");
    await removeIf("full.avi");
    await removeIf("videoOnly.avi");
	
	// SETUP
	await fs.copyFile(__dirname + '\\hdConfig\\Dolphin.ini', __dirname + '\\User\\Config\\Dolphin.ini');
	await fs.copyFile(__dirname + '\\hdConfig\\GFX.ini', __dirname + '\\User\\Config\\GFX.ini');

    // PREPARE
    // const slpFile = process.argv[2];
    const slpFile = createWriteStream(__dirname + "\\todo.slp");
    http.get(`http://${IP}:3000/api/hdTake`, async (res) => {
        const filename = res
            .headers["content-disposition"]
            .split("filename=")[1]
            .split(".slp")[0]
            .trim();
        console.log({ filename });
        res.pipe(slpFile);
        await new Promise(fulfill => slpFile.on("finish", fulfill));
        const game = getGame(__dirname + "\\todo.slp");
        const settings = game.getSettings();
        const metadata = game.getMetadata();
	    const mLastFrame = (metadata || {}).lastFrame;
	    const cLastFrame = Math.max(...Object.keys(game.getFrames()).map(s => parseInt(s, 10)));
	    const lastFrame = mLastFrame || cLastFrame;

        const is0 = game.isMe(0);
        const DATA = getData(game);

        const wrapUp = async () => {
            console.log("vidOfFrames...");
            await pexec(
                `python "${__dirname}\\vidOfFrames.py"`
            );
            console.log("audio...");
            await pexec(
                `ffmpeg -i "${__dirname}\\videoOnly.avi" -i "${__dirname}\\User\\Dump\\Audio\\dspdump.wav" -c:v copy -c:a aac "${__dirname}\\full.avi"`
            );
            console.log("uploading...");
            const req1 = request.post(`http://${IP}:3000/api/${filename}/hdUpload`, () => {
                console.log("Requesting new in 5 seconds...");
                setTimeout(main, 5000);
            });
            const form1 = req1.form();
            form1.append("vod", createReadStream(__dirname + "\\full.avi"));
        };

        if (DATA.isSkip) {
            request.post({
                url: `http://${IP}:3000/api/${filename}/reject`,
                form: { skipReason: DATA.skipReason }
            }, () => {
                console.log("Requesting new in 5 seconds...");
                setTimeout(main, 5000);
            });
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
            let timeoutId = null;
            let resetTimeout = () => {
                timeoutId = setTimeout(
                    () => {
                        slippiProc.kill();
                        console.log("Broke... trying again in 5 seconds");
                        setTimeout(() => main(), 5000);
                    },
                    60000,
                );
            };

            let launched = false;
            slippiProc.stdout.on("data", (data) => {
                const msg = data.toString().trim();
                clearTimeout(timeoutId);
                resetTimeout();
                if (msg.startsWith("[CURRENT_FRAME]")) {
                    const currentFrame = parseInt(msg.split("[CURRENT_FRAME]")[1].trim());
                    console.log(filename, { currentFrame, lastFrame });
                    if (currentFrame === lastFrame && !launched) {
                        launched = true;
                        clearTimeout(timeoutId);
                        resetTimeout = () => {};
                        setTimeout(
                            () => {
                                slippiProc.kill();
                                wrapUp();
                            },
                            150000
                        );
                    }
                }
            });
        }
    });
};

main();
