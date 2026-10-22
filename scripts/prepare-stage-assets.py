"""由 assest/ 原始素材建立遊戲衍生檔；需要 ffmpeg 與 Pillow。原始檔不修改。"""
from pathlib import Path
import subprocess
from PIL import Image, ImageChops

root = Path(__file__).resolve().parents[1]
source = root / 'assest'
lab = root / 'public/test-assets/stages/laboratory'
attract = root / 'public/test-assets/attract'
lab.mkdir(parents=True, exist_ok=True)
attract.mkdir(parents=True, exist_ok=True)
subprocess.run(['ffmpeg', '-y', '-i', str(source / 'stage_lab_bg.mp4'), '-an',
                '-vf', 'scale=2560:960', '-c:v', 'libx264', '-crf', '24',
                '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(lab / 'bg.mp4')], check=True)
subprocess.run(['ffmpeg', '-y', '-ss', '1', '-i', str(lab / 'bg.mp4'),
                '-frames:v', '1', str(lab / 'poster.jpg')], check=True)
# 開頭動畫保留音軌，壓縮成 720p 以縮短載入。
subprocess.run(['ffmpeg', '-y', '-i', str(source / 'StreetFight_video.mp4'),
                '-c:v', 'libx264', '-crf', '26', '-preset', 'medium', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(attract / 'intro.mp4')], check=True)
foreground = Image.open(source / 'Stage_lab_font.png').convert('RGBA').resize((2560, 960), Image.Resampling.LANCZOS)
alpha = foreground.getchannel('A')
# 僅保留下緣地板，避免整面建築和影片用不同速度移動造成硬接縫。
fade = Image.new('L', foreground.size)
for y in range(960):
    fade.paste(round(255 * min(1, max(0, (y - 770) / 110))), (0, y, 2560, y + 1))
foreground.putalpha(ImageChops.multiply(alpha, fade))
foreground.save(lab / 'foreground.png')
print('完成：實驗室 2560×960 靜音影片、poster、羽化前景，與 720p 開頭動畫。')
