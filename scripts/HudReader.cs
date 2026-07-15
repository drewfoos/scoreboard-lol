// Reads exact numbers from the LoL spectator HUD top strip (cover mode):
// per-team objective counts (drakes, grubs, herald, turrets) and exact gold.
// Values are segmented by text color (cyan = blue side, red = red side) and
// glyphs matched against templates rendered from Riot's own HUD fonts.
//
// Usage:
//   HudReader.exe --file frame.png [--debug outdir]   offline test
//   HudReader.exe [--debug outdir]                    capture LoL window
// Output: one JSON line on stdout.
// Compiled with .NET Framework csc (C# 5).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

static class Win32
{
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    public struct RECT { public int Left, Top, Right, Bottom; }
}

class Glyph
{
    public int X, Y, W, H;
    public bool[,] Mask; // trimmed binary mask
}

class Cluster
{
    public int X0, X1;
    public List<Glyph> Glyphs = new List<Glyph>();
    public string Text = "";
}

static class HudReader
{
    // strip region at 1920x1080 (generous)
    const int STRIP_X = 300, STRIP_Y = 0, STRIP_W = 1320, STRIP_H = 70;
    const int FIELD_GAP = 14;   // px gap separating value fields
    const int GLYPH_GAP = 2;    // px gap separating glyphs
    const string CHARS = "0123456789.k";

    // tight thresholds: antialiased edge pixels must NOT pass, or touching
    // glyphs merge into one run
    // HUD cyan is pure (0,153,224); R stays ~0 even antialiased
    static bool IsCyan(Color c) { return c.R < 40 && c.G > 115 && c.B > 170; }
    static bool IsRed(Color c) { return c.R > 205 && c.G < 95 && c.B < 115 && (c.R - c.G) > 115; }

    static void Main(string[] args)
    {
        string file = null, debugDir = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--file" && i + 1 < args.Length) file = args[++i];
            if (args[i] == "--debug" && i + 1 < args.Length) debugDir = args[++i];
        }

        try
        {
            Bitmap frame = file != null ? new Bitmap(file) : CaptureLol();
            if (frame == null) { Console.WriteLine("{\"ok\":false,\"error\":\"no game window\"}"); return; }
            using (frame)
            {
                var result = ReadHud(frame, debugDir);
                Console.WriteLine(result);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"ok\":false,\"error\":" + Quote(ex.Message) + "}");
        }
    }

    static Bitmap CaptureLol()
    {
        var procs = System.Diagnostics.Process.GetProcesses()
            .Where(p => p.ProcessName.StartsWith("League of Legends") && p.MainWindowHandle != IntPtr.Zero);
        var proc = procs.FirstOrDefault();
        if (proc == null) return null;
        Win32.RECT r;
        Win32.GetWindowRect(proc.MainWindowHandle, out r);
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return null;
        var bmp = new Bitmap(w, h);
        using (var g = Graphics.FromImage(bmp))
            g.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(w, h));
        return bmp;
    }

    static string ReadHud(Bitmap frame, string debugDir)
    {
        // scale coordinates if not 1920-wide (proportional HUD)
        double scale = frame.Width / 1920.0;
        int sx = (int)(STRIP_X * scale), sy = (int)(STRIP_Y * scale);
        int sw = (int)(STRIP_W * scale), sh = (int)(STRIP_H * scale);
        sw = Math.Min(sw, frame.Width - sx);
        sh = Math.Min(sh, frame.Height - sy);

        var cyanClusters = FindClusters(frame, sx, sy, sw, sh, true);
        var redClusters = FindClusters(frame, sx, sy, sw, sh, false);

        // templates sized to median glyph height
        var allGlyphs = cyanClusters.Concat(redClusters).SelectMany(c => c.Glyphs).ToList();
        if (allGlyphs.Count == 0) return "{\"ok\":false,\"error\":\"no colored digits found\"}";
        var heights = allGlyphs.Select(g => g.H).OrderBy(h => h).ToList();
        int medH = heights[heights.Count / 2];
        var templates = RenderTemplates(medH);

        foreach (var c in cyanClusters) c.Text = Classify(c, templates);
        foreach (var c in redClusters) c.Text = Classify(c, templates);

        if (debugDir != null) DumpDebug(frame, sx, sy, sw, sh, cyanClusters, redClusters, debugDir);

        // blue side: left->right = drakes, barons, grubs, turrets, gold, kills
        // red side:  left->right = kills, gold, turrets, grubs, barons, drakes
        // (per in-game HUD order; there is no herald counter)
        var blue = cyanClusters.OrderBy(c => c.X0).ToList();
        var red = redClusters.OrderBy(c => c.X0).ToList();

        string blueJson = SideJson(blue, false);
        string redJson = SideJson(red, true);
        bool ok = blue.Count >= 5 && red.Count >= 5;
        return "{\"ok\":" + (ok ? "true" : "false") + ",\"blue\":" + blueJson + ",\"red\":" + redJson +
               ",\"blueFields\":" + FieldsJson(blue) + ",\"redFields\":" + FieldsJson(red) + "}";
    }

    static string SideJson(List<Cluster> side, bool mirrored)
    {
        // mirrored (red): kills, gold, turrets, grubs, barons, drakes
        if (side.Count < 5) return "null";
        List<string> vals = side.Select(c => c.Text).ToList();
        string drakes, barons, grubs, turrets, gold, kills;
        if (!mirrored)
        {
            drakes = vals[0]; barons = vals[1]; grubs = vals[2]; turrets = vals[3]; gold = vals[4];
            kills = vals.Count > 5 ? vals[5] : "";
        }
        else
        {
            int n = vals.Count;
            drakes = vals[n - 1]; barons = vals[n - 2]; grubs = vals[n - 3]; turrets = vals[n - 4]; gold = vals[n - 5];
            kills = n > 5 ? vals[0] : "";
        }
        return "{\"dragons\":" + Num(drakes) + ",\"barons\":" + Num(barons) + ",\"grubs\":" + Num(grubs) +
               ",\"turrets\":" + Num(turrets) + ",\"gold\":" + GoldNum(gold) + ",\"kills\":" + Num(kills) +
               ",\"goldText\":" + Quote(gold) + "}";
    }

    static string FieldsJson(List<Cluster> side)
    {
        return "[" + string.Join(",", side.Select(c => Quote(c.Text)).ToArray()) + "]";
    }

    static string Num(string t)
    {
        int v;
        return int.TryParse(t, out v) ? v.ToString() : "null";
    }

    static string GoldNum(string t)
    {
        // "5.2k" -> 5200 ; "62.3k" -> 62300 ; plain digits -> as-is
        t = (t ?? "").Trim();
        if (t.EndsWith("k"))
        {
            double d;
            if (double.TryParse(t.Substring(0, t.Length - 1), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out d))
                return ((int)Math.Round(d * 1000)).ToString();
        }
        int v;
        if (int.TryParse(t, out v)) return v.ToString();
        return "null";
    }

    static List<Cluster> FindClusters(Bitmap bmp, int sx, int sy, int sw, int sh, bool cyan)
    {
        // column occupancy of color-masked pixels
        var colHit = new bool[sw];
        var mask = new bool[sw, sh];
        for (int x = 0; x < sw; x++)
            for (int y = 0; y < sh; y++)
            {
                Color c = bmp.GetPixel(sx + x, sy + y);
                bool hit = cyan ? IsCyan(c) : IsRed(c);
                mask[x, y] = hit;
                if (hit) colHit[x] = true;
            }

        var clusters = new List<Cluster>();
        int start = -1, gap = 0;
        for (int x = 0; x <= sw; x++)
        {
            bool hit = x < sw && colHit[x];
            if (hit) { if (start < 0) start = x; gap = 0; }
            else if (start >= 0)
            {
                gap++;
                if (gap > FIELD_GAP || x == sw)
                {
                    var cl = new Cluster { X0 = sx + start, X1 = sx + x - gap };
                    SplitGlyphs(cl, mask, start, x - gap, sw, sh, sx, sy);
                    if (cl.Glyphs.Count > 0) clusters.Add(cl);
                    start = -1; gap = 0;
                }
            }
        }
        // drop noise clusters (single tiny glyph shorter than 6px)
        return clusters.Where(c => c.Glyphs.Any(g => g.H >= 6)).ToList();
    }

    static void SplitGlyphs(Cluster cl, bool[,] mask, int x0, int x1, int sw, int sh, int sx, int sy)
    {
        // column pixel counts; columns with <=1 pixel count as gaps (kills the
        // 1px antialiasing bridges between touching glyphs)
        var colCount = new int[x1 - x0 + 1];
        for (int x = x0; x <= x1; x++)
            for (int y = 0; y < sh; y++)
                if (mask[x, y]) colCount[x - x0]++;

        int start = -1;
        for (int x = x0; x <= x1 + 1; x++)
        {
            bool hit = x <= x1 && colCount[x - x0] >= 1;
            if (hit) { if (start < 0) start = x; }
            else if (start >= 0)
            {
                AddGlyphSplitWide(cl, mask, start, x - 1, sh, colCount, x0);
                start = -1;
            }
        }
    }

    // add glyph run, splitting touching glyphs (like "5.2k") at the weakest
    // columns near evenly-spaced expected boundaries
    static void AddGlyphSplitWide(Cluster cl, bool[,] mask, int gx0, int gx1, int sh, int[] colCount, int baseX)
    {
        var g = TrimGlyph(mask, gx0, gx1, sh);
        if (g == null) return;
        double glyphW = g.H * 0.78; // typical digit advance at this font
        int n = (int)Math.Round(g.W / glyphW);
        if (n <= 1 || g.W < 10) { cl.Glyphs.Add(g); return; }

        var cuts = new List<int>();
        for (int i = 1; i < n; i++)
        {
            int target = gx0 + (int)Math.Round((double)g.W * i / n);
            int best = -1, min = int.MaxValue;
            for (int x = Math.Max(gx0 + 2, target - 3); x <= Math.Min(gx1 - 2, target + 3); x++)
            {
                int c = colCount[x - baseX];
                if (c < min) { min = c; best = x; }
            }
            if (best > 0) cuts.Add(best);
        }
        int prev = gx0;
        foreach (int cut in cuts.Distinct().OrderBy(v => v))
        {
            var part = TrimGlyph(mask, prev, cut, sh);
            if (part != null) cl.Glyphs.Add(part);
            prev = cut + 1;
        }
        var last = TrimGlyph(mask, prev, gx1, sh);
        if (last != null) cl.Glyphs.Add(last);
    }

    static Glyph TrimGlyph(bool[,] mask, int x0, int x1, int sh)
    {
        int top = int.MaxValue, bot = -1;
        for (int x = x0; x <= x1; x++)
            for (int y = 0; y < sh; y++)
                if (mask[x, y]) { if (y < top) top = y; if (y > bot) bot = y; }
        if (bot < 0) return null;
        int w = x1 - x0 + 1, h = bot - top + 1;
        var m = new bool[w, h];
        for (int x = 0; x < w; x++)
            for (int y = 0; y < h; y++)
                m[x, y] = mask[x0 + x, top + y];
        return new Glyph { X = x0, Y = top, W = w, H = h, Mask = m };
    }

    // ------------------------------------------------------------ templates
    const int TW = 14, TH = 20;

    static Dictionary<char, List<bool[,]>> RenderTemplates(int pixelHeight)
    {
        var fonts = new PrivateFontCollection();
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        foreach (var f in new[] { "beaufort-bold.ttf", "spiegel-bold.ttf" })
        {
            string p1 = Path.Combine(baseDir, f);
            string p2 = Path.Combine(baseDir, "..", "assets", "fonts", f);
            if (File.Exists(p1)) fonts.AddFontFile(p1);
            else if (File.Exists(p2)) fonts.AddFontFile(p2);
        }

        var dict = new Dictionary<char, List<bool[,]>>();
        foreach (char ch in CHARS) dict[ch] = new List<bool[,]>();

        foreach (var family in fonts.Families)
        {
            // find an em size whose digit cap height ~ pixelHeight
            for (float em = pixelHeight * 0.9f; em <= pixelHeight * 1.7f; em += 1f)
            {
                var f = new Font(family, em, FontStyle.Bold, GraphicsUnit.Pixel);
                var probe = RasterChar('0', f);
                if (probe == null) continue;
                int h = probe.GetLength(1);
                // collect ALL sizes within 2px of the observed glyph height —
                // multiple variants per char make the nearest-match robust
                if (Math.Abs(h - pixelHeight) <= 2)
                {
                    foreach (char ch in CHARS)
                    {
                        var m = RasterChar(ch, f);
                        if (m != null) dict[ch].Add(Normalize(m));
                    }
                }
            }
        }
        return dict;
    }

    static bool[,] RasterChar(char ch, Font f)
    {
        using (var bmp = new Bitmap(64, 64))
        using (var g = Graphics.FromImage(bmp))
        {
            g.Clear(Color.Black);
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.DrawString(ch.ToString(), f, Brushes.White, 4, 4);
            // threshold + trim
            int x0 = 64, x1 = -1, y0 = 64, y1 = -1;
            var raw = new bool[64, 64];
            for (int x = 0; x < 64; x++)
                for (int y = 0; y < 64; y++)
                {
                    var c = bmp.GetPixel(x, y);
                    if (c.R > 110)
                    {
                        raw[x, y] = true;
                        if (x < x0) x0 = x; if (x > x1) x1 = x;
                        if (y < y0) y0 = y; if (y > y1) y1 = y;
                    }
                }
            if (x1 < 0) return null;
            var m = new bool[x1 - x0 + 1, y1 - y0 + 1];
            for (int x = 0; x <= x1 - x0; x++)
                for (int y = 0; y <= y1 - y0; y++)
                    m[x, y] = raw[x0 + x, y0 + y];
            return m;
        }
    }

    static bool[,] Normalize(bool[,] m)
    {
        var n = new bool[TW, TH];
        int w = m.GetLength(0), h = m.GetLength(1);
        for (int x = 0; x < TW; x++)
            for (int y = 0; y < TH; y++)
                n[x, y] = m[Math.Min(w - 1, x * w / TW), Math.Min(h - 1, y * h / TH)];
        return n;
    }

    static string Classify(Cluster cl, Dictionary<char, List<bool[,]>> templates)
    {
        var sb = new StringBuilder();
        int medH = cl.Glyphs.Select(g => g.H).OrderBy(h => h).ToList()[cl.Glyphs.Count / 2];
        foreach (var g in cl.Glyphs)
        {
            // tiny + low glyph = decimal point
            if (g.H <= medH * 0.35 && g.W <= medH * 0.5) { sb.Append('.'); continue; }
            var norm = Normalize(g.Mask);
            char best = '?';
            double bestScore = -1;
            foreach (var kv in templates)
                foreach (var t in kv.Value)
                {
                    double s = Score(norm, t);
                    if (s > bestScore) { bestScore = s; best = kv.Key; }
                }
            sb.Append(best);
        }
        return sb.ToString();
    }

    static double Score(bool[,] a, bool[,] b)
    {
        int match = 0, total = 0;
        for (int x = 0; x < TW; x++)
            for (int y = 0; y < TH; y++)
            {
                if (a[x, y] || b[x, y]) total++;
                if (a[x, y] && b[x, y]) match++;
            }
        return total == 0 ? 0 : (double)match / total;
    }

    static void DumpDebug(Bitmap frame, int sx, int sy, int sw, int sh,
        List<Cluster> cyan, List<Cluster> red, string dir)
    {
        Directory.CreateDirectory(dir);
        using (var strip = frame.Clone(new Rectangle(sx, sy, sw, sh), frame.PixelFormat))
        using (var g = Graphics.FromImage(strip))
        {
            foreach (var c in cyan) g.DrawRectangle(Pens.Lime, c.X0 - sx, 2, c.X1 - c.X0, sh - 5);
            foreach (var c in red) g.DrawRectangle(Pens.Yellow, c.X0 - sx, 2, c.X1 - c.X0, sh - 5);
            strip.Save(Path.Combine(dir, "strip-annotated.png"), ImageFormat.Png);
        }
        var lines = cyan.Select(c => "cyan " + c.X0 + ".." + c.X1 + " -> " + c.Text)
            .Concat(red.Select(c => "red " + c.X0 + ".." + c.X1 + " -> " + c.Text));
        File.WriteAllLines(Path.Combine(dir, "clusters.txt"), lines.ToArray());
    }

    static string Quote(string s)
    {
        return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}
