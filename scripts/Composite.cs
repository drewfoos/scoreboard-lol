// Recovers overlay RGBA from two screenshots (black + white backgrounds)
// and composites onto a game frame. Uses LockBits for speed. Usage:
//   Composite.exe black.png white.png game.png out.png
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

static class Composite
{
    static byte[] Load(string path, out int w, out int h)
    {
        using (var bmp = new Bitmap(path))
        {
            w = bmp.Width; h = bmp.Height;
            var r = new Rectangle(0, 0, w, h);
            var d = bmp.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            var buf = new byte[Math.Abs(d.Stride) * h];
            Marshal.Copy(d.Scan0, buf, 0, buf.Length);
            bmp.UnlockBits(d);
            return buf;
        }
    }

    static void Main(string[] args)
    {
        int bw, bh, ww, wh, gw, gh;
        var black = Load(args[0], out bw, out bh);
        var white = Load(args[1], out ww, out wh);
        var game = Load(args[2], out gw, out gh);

        int w = Math.Min(bw, gw), h = Math.Min(bh, gh);
        var outBuf = (byte[])game.Clone();

        for (int y = 0; y < h; y++)
        {
            int rowB = y * bw * 4, rowG = y * gw * 4;
            for (int x = 0; x < w; x++)
            {
                int ib = rowB + x * 4, ig = rowG + x * 4;
                int dbB = white[ib] - black[ib];
                int dbG = white[ib + 1] - black[ib + 1];
                int dbR = white[ib + 2] - black[ib + 2];
                double a = 1.0 - (dbR + dbG + dbB) / (3.0 * 255.0);
                if (a <= 0.004) continue;
                if (a > 1) a = 1;
                for (int c = 0; c < 3; c++)
                {
                    double fg = black[ib + c] / a;
                    double v = fg * a + outBuf[ig + c] * (1 - a);
                    outBuf[ig + c] = (byte)Math.Max(0, Math.Min(255, (int)Math.Round(v)));
                }
                outBuf[ig + 3] = 255;
            }
        }

        using (var outBmp = new Bitmap(gw, gh, PixelFormat.Format32bppArgb))
        {
            var r = new Rectangle(0, 0, gw, gh);
            var d = outBmp.LockBits(r, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(outBuf, 0, d.Scan0, outBuf.Length);
            outBmp.UnlockBits(d);
            outBmp.Save(args[3], ImageFormat.Png);
        }
        Console.WriteLine("composited " + args[3]);
    }
}
