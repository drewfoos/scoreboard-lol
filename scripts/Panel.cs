// Native window shell for the control panel: WinForms + WebView2.
// Compiled with the built-in .NET Framework csc (C# 5 syntax only).
// Gives the app its own taskbar identity and icon instead of an Edge window.
using System;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class PanelForm : Form
{
    private string url;

    public PanelForm(string url)
    {
        this.url = url;
        Text = "LoL Scoreboard";
        ClientSize = new Size(1480, 900);
        MinimumSize = new Size(900, 560);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(11, 14, 18);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        WebView2 wv = new WebView2();
        wv.Dock = DockStyle.Fill;
        wv.DefaultBackgroundColor = Color.FromArgb(11, 14, 18);
        CoreWebView2CreationProperties props = new CoreWebView2CreationProperties();
        props.UserDataFolder = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
            + "\\LoL Scoreboard\\WebView2";
        wv.CreationProperties = props;
        wv.CoreWebView2InitializationCompleted += OnWebViewReady;
        Controls.Add(wv);
        wv.Source = new Uri(url);
    }

    private void OnWebViewReady(object sender, CoreWebView2InitializationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            // WebView2 runtime missing/broken: fall back to default browser.
            try { System.Diagnostics.Process.Start(url); } catch { }
            Close();
            return;
        }
        WebView2 wv = (WebView2)sender;
        wv.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        wv.CoreWebView2.Settings.IsZoomControlEnabled = false;
        // window.close() from the page (Quit button) closes the native window
        wv.CoreWebView2.WindowCloseRequested += delegate { Close(); };
    }

    [STAThread]
    static void Main(string[] args)
    {
        string url = args.Length > 0 ? args[0] : "http://localhost:3000/control";
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            Application.Run(new PanelForm(url));
        }
        catch
        {
            try { System.Diagnostics.Process.Start(url); } catch { }
        }
    }
}
