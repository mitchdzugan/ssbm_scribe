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
const decompress                        = require("decompress");
const config                            = require("./config.json");

const pexec = util.promisify(exec);

const dumpPath = __dirname + "\\User\\Dump\\";
const slippiExe = config.slippiExe;

const IP = "192.168.1.15";

const getGame = (path) => {
    const game = new SlippiGame(path);
    const settings = game.getSettings();
    const metadata = game.getMetadata();
    game.isMe = (n) => {
        const codeA = ((((settings || {}).players || [])[n] || {}).connectCode || "").toLowerCase();
        const codeB = (((((metadata || {}).players || [])[n] || {}).names || {}).code || "").toLowerCase();
        return (
            codeA === "pink#715" || 
            codeB === "pink#715"
        );
    };
    return game;
};


const removeIf = async (name) => {
    const hasIt = existsSync(__dirname + "\\" + name);
    if (hasIt) {
        await fs.unlink(__dirname + "\\" + name);
    }
};

const recNext = async (setId, games, i) => {
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

    await removeIf("todo.slp");
    await removeIf("ready.slp");
    await removeIf("final.mp4");
    await removeIf("preview.mp4");
    await removeIf("full.avi");
    await removeIf("videoOnly.avi");
	
	// SETUP
	await fs.copyFile(__dirname + '\\setConfig\\Dolphin.ini', __dirname + '\\User\\Config\\Dolphin.ini');
	await fs.copyFile(__dirname + '\\setConfig\\GFX.ini', __dirname + '\\User\\Config\\GFX.ini');

    // PREPARE
    const filename = '';
    const game = getGame(__dirname + "\\games\\" + i + ".slp");
    const settings = game.getSettings();
    const metadata = game.getMetadata();
    const mLastFrame = (metadata || {}).lastFrame;
    const cLastFrame = Math.max(...Object.keys(game.getFrames()).map(s => parseInt(s, 10)));
    const lastFrame = mLastFrame || cLastFrame;
    const is0 = game.isMe(0);
    const wrapUp = async () => {
        console.log("audio...");
        await pexec(
            `ffmpeg -i "${__dirname}\\User\\Dump\\Frames\\framedump0.avi" -i "${__dirname}\\User\\Dump\\Audio\\dspdump.wav" -c:v copy -c:a aac "${__dirname}\\full.avi"`
        );
        const vidLength = lastFrame + 220;
        const mins = Math.floor(vidLength / 60 / 60)
        const secs = (vidLength / 60) % 60;
        const secsStr = `${secs < 10 ? '0' : ''}${secs}`;
        console.log(`-t 00:0${mins}:${secsStr}`);
        await pexec(
            `ffmpeg -i "${__dirname}\\full.avi" -c copy -ss 00:00:00 -t 00:0${mins}:${secsStr} "${__dirname}\\${i}.avi"`
        );
        if (games.length > i + 1) {
            recNext(setId, games, i + 1);
        } else {
            let paths = "";
            let j = 0;
            while (j < games.length) {
                paths += `file './${j}.avi'\n`
                j++;
            }
            await fs.writeFile('./paths.txt', paths);
            const ccat = spawn(
                'ffmpeg', ['-f', 'concat', '-safe', '0', '-i', './paths.txt', '-c', 'copy', './fullset.avi']
            );
            ccat.stdout.on('data', (data) => {
                console.log(`${data}`);
            });
              
            ccat.stderr.on('data', (data) => {
                console.log(`${data}`);
            });
            await new Promise(fulfill => ccat.on("close", fulfill));
            const audi = spawn(
                'ffmpeg', ['-i', './fullset.avi', '-c:v', 'copy', '-filter:a', "volume=0.18", './set.avi']
            );
            audi.stdout.on('data', (data) => {
                console.log(`${data}`);
            });
              
            audi.stderr.on('data', (data) => {
                console.log(`${data}`);
            });
            await new Promise(fulfill => audi.on("close", fulfill));
            console.log("uploading vod...");
            const req1 = request.post(`http://${IP}:3000/api/${setId}/setupload`, () => {
                console.log("Requesting new in 5 seconds...");
                setTimeout(main, 5000);
            });
            const form1 = req1.form();
            form1.append("vod", createReadStream(__dirname + "\\set.avi"));
        }
    };

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
    const buffer = await fs.readFile(__dirname + "\\games\\" + i + ".slp");
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
            console.log(setId, filename, { currentFrame, lastFrame });
            if (currentFrame === lastFrame && !launched) {
                launched = true;
                clearTimeout(timeoutId);
                resetTimeout = () => {};
                setTimeout(
                    () => {
                        slippiProc.kill();
                        wrapUp();
                    },
                    10000
                );
            }
        }
    });
};

const main = async () => {
    await removeIf("0.avi");
    await removeIf("1.avi");
    await removeIf("2.avi");
    await removeIf("set.avi");
    await removeIf("fullset.avi");
    await fs.rm(__dirname + "\\games", { recursive: true, force: true });
    const zipFile = createWriteStream(__dirname + "\\todo.zip");
    http.get(`http://${IP}:3000/api/takeset`, async (res) => {
        res.pipe(zipFile);
        await new Promise(fulfill => zipFile.on("finish", fulfill));
        await decompress(__dirname + "\\todo.zip", __dirname + "\\games\\");
        const dataBuff = await fs.readFile('./games/data.json')
        const { setId, games } = JSON.parse(dataBuff.toString());
        await recNext(setId, games, 0);
        return;
    });
}

main();
