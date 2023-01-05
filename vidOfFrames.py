#!/usr/bin/env python3

import cv2
import os
import numpy as np
import skvideo.io

dumpPath = ".\\User\\Dump\\Frames"

def main():
    files = os.listdir(dumpPath)
    frames = []
    fname = "./videoOnly.avi"
    
    writer = skvideo.io.FFmpegWriter(fname, inputdict={
        '-r': '60',
    }, outputdict={
        '-r': '60',
        '-vcodec': 'libx264',  # use the h.264 codec
        '-crf': '0',           # set the constant rate factor to 0, which is lossless
        '-preset':'veryslow'   # the slower the better compression, in princple, try 
                               # other options see https://trac.ffmpeg.org/wiki/Encode/H.264
    })
    for file in files:
        if file.startswith("framedump_") and file.endswith(".png"):
            frames.append({
                "file": file,
                "n": int(file.split(".png")[0].split("framedump_")[1])
            })
    frames.sort(key=lambda frame: frame["n"])
    for frame in frames:
        print([frame["n"], len(frames)])
        img = cv2.imread(dumpPath + "\\" + frame["file"], cv2.IMREAD_COLOR)
        if img is None:
            continue
        yOff = 0
        xOff = (1920 - img.shape[1]) // 2
        final = np.zeros((1080, 1920, 3), dtype="uint8")
        final[yOff:yOff + img.shape[0], xOff:xOff + img.shape[1]] = img
        writer.writeFrame(final[:,:,::-1])  
    writer.close()

main()