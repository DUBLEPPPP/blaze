import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const fallbackAvatar = "https://i.pinimg.com/736x/0d/ad/95/0dad951463f4f4f97294a7a976946b64.jpg";
const purchaseUrl = "https://www.pedri.lol/";

type Tab = "overview" | "redeem" | "reset" | "download" | "purchase";

type DiscordProfile = {
  id: string;
  username: string;
  name: string;
  avatar: string;
  banner?: string | null;
  accentColor?: number | null;
};

type LicenseInfo = {
  key?: string;
  status?: string;
  username?: string;
  level?: number | string;
  expires?: number | null;
  days?: number | null;
  authToken?: string;
};

type Session = {
  discord: DiscordProfile;
  license?: LicenseInfo | null;
};

type ApiState = {
  loading: boolean;
  message: string;
  ok: boolean | null;
};

const navItems: Array<{ id: Tab; icon: string; label: string }> = [
  { id: "overview", icon: "O", label: "Overview" },
  { id: "redeem", icon: "K", label: "Redeem Code" },
  { id: "reset", icon: "R", label: "HWID Reset" },
  { id: "download", icon: "D", label: "Download" },
  { id: "purchase", icon: "P", label: "Purchase" }
];

async function readApiJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API returned ${response.status}: ${text.slice(0, 120) || response.statusText}`);
  }
}

function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [license, setLicense] = useState("");
  const [redeemState, setRedeemState] = useState<ApiState>({ loading: false, message: "", ok: null });
  const [resetState, setResetState] = useState<ApiState>({ loading: false, message: "", ok: null });

  useEffect(() => {
    fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) return null;
        return readApiJson(response);
      })
      .then((data) => {
        if (data?.success) setSession(data.session);
      })
      .finally(() => setLoadingSession(false));
  }, []);

  const licenseInfo = session?.license || null;
  const licenseStatus = useMemo(() => {
    if (!licenseInfo) return "NO LICENSE";
    return String(licenseInfo.status || "ACTIVE").toUpperCase();
  }, [licenseInfo]);

  const rank = licenseStatus === "ACTIVE" ? "PREMIUM" : "USER";
  const daysText = licenseInfo?.days === null || licenseInfo?.days === undefined
    ? "Lifetime / Unknown"
    : `${licenseInfo.days} days left`;

  async function redeemLicense() {
    setRedeemState({ loading: true, message: "Linking license...", ok: null });

    try {
      const response = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license })
      });
      const data = await readApiJson(response);
      setRedeemState({ loading: false, message: data.message || "Done", ok: Boolean(data.success) });
      if (data.success && session) {
        setSession({ ...session, license: data.license });
        setLicense("");
      }
    } catch (error) {
      setRedeemState({
        loading: false,
        message: error instanceof Error ? error.message : "Could not contact the API.",
        ok: false
      });
    }
  }

  async function resetHwid() {
    setResetState({ loading: true, message: "Resetting HWID...", ok: null });

    try {
      const response = await fetch("/api/reset-hwid", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await readApiJson(response);
      setResetState({ loading: false, message: data.message || "Done", ok: Boolean(data.success) });
    } catch (error) {
      setResetState({
        loading: false,
        message: error instanceof Error ? error.message : "Could not contact the API.",
        ok: false
      });
    }
  }

  if (loadingSession) {
    return <main className="login-page"><div className="login-card"><div className="loader" /></div></main>;
  }

  if (!session) {
    return <LoginPage />;
  }

  const avatar = session.discord.avatar || fallbackAvatar;
  const profileStyle = session.discord.banner
    ? ({ "--profile-banner": `url("${session.discord.banner}")` } as React.CSSProperties)
    : undefined;

  return (
    <main className="dashboard-shell">
      <aside className="side-nav">
        <div className="side-brand">BLAZA</div>
        <div className="nav-card">
          {navItems.map((item) => (
            <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
        <a className="logout-card" href="/api/logout">Logout</a>
      </aside>

      <section className="content-shell">
        <header className="content-header">
          <div>
            <span className="eyebrow">Blaza PVP</span>
            <h1>{navItems.find((item) => item.id === tab)?.label}</h1>
          </div>
          <div className="header-user">
            <span>{rank}</span>
            <img src={avatar} alt="Profile avatar" />
          </div>
        </header>

        {tab === "overview" && (
          <section className="overview-grid">
            <article className={session.discord.banner ? "profile-panel has-banner" : "profile-panel"} style={profileStyle}>
              <img src={avatar} alt="Profile avatar" />
              <div>
                <span>{rank}</span>
                <h2>{session.discord.name}</h2>
                <p>Discord ID: {session.discord.id}</p>
              </div>
            </article>
            <InfoCard label="Rank" value={rank} premium={rank === "PREMIUM"} />
            <InfoCard label="License" value={licenseStatus} subValue={licenseInfo ? daysText : "Redeem a key"} danger={licenseStatus !== "ACTIVE"} />
            <InfoCard label="Config" value={licenseInfo ? "READY" : "LOCKED"} subValue={licenseInfo ? "Download enabled" : "License required"} danger={!licenseInfo} />
          </section>
        )}

        {tab === "redeem" && (
          <section className="panel form-panel">
            <h2>Redeem License</h2>
            <p className="muted">Your key will be linked to this Discord account.</p>
            <input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="blaze-xxxx-xxxx-xxxx" />
            <button onClick={redeemLicense} disabled={redeemState.loading}>{redeemState.loading ? "Linking..." : "Redeem License"}</button>
            <Status state={redeemState} />
          </section>
        )}

        {tab === "reset" && (
          <section className="panel form-panel">
            <h2>HWID Reset</h2>
            <p className="muted">Reset the PC lock for the license linked to your Discord account.</p>
            <button onClick={resetHwid} disabled={resetState.loading || !licenseInfo}>{resetState.loading ? "Resetting..." : "Reset HWID"}</button>
            <Status state={resetState} />
          </section>
        )}

        {tab === "download" && (
          <section className="download-panel">
            <div>
              <span className="eyebrow">Software Config</span>
              <h2>Download License Config</h2>
              <p className="muted">This file links your app to the Discord account that redeemed the license.</p>
            </div>
            <div className="download-actions">
              <a className={!licenseInfo ? "disabled" : ""} href={licenseInfo ? "/api/download-config" : undefined}>Download Config</a>
              <small>{licenseInfo ? "Place it in Downloads or next to the app." : "Redeem a license first."}</small>
            </div>
          </section>
        )}

        {tab === "purchase" && (
          <section className="purchase-panel">
            <div>
              <span className="eyebrow">Access</span>
              <h2>Buy License</h2>
              <p className="muted">Buy a license, log in with Discord, and redeem it here.</p>
            </div>
            <a href={purchaseUrl} target="_blank" rel="noreferrer">Open Store</a>
          </section>
        )}
      </section>
    </main>
  );
}

function LoginPage() {
  const error = new URLSearchParams(window.location.search).get("auth_error");

  return (
    <main className="login-page">
      <div className="login-bg" />
      <section className="login-card">
        <div className="brand-mark">B</div>
        <h1>Sign in to <span>Blaza</span></h1>
        <p>Access your dashboard to manage your license, reset HWID, and view premium status.</p>
        <a className="discord-button" href="/api/discord-login">Login with Discord</a>
        <div className="secure-row"><span />Secure Authentication<span /></div>
        <p className="fine-print">No password required. Discord OAuth2 only.</p>
        {error && <p className="status bad">{error}</p>}
      </section>
    </main>
  );
}

function InfoCard({ label, value, subValue, danger = false, premium = false }: { label: string; value: string; subValue?: string; danger?: boolean; premium?: boolean }) {
  return (
    <article className="info-card">
      <span>{label}</span>
      <strong className={danger ? "danger" : premium ? "premium" : ""}>{value}</strong>
      {subValue && <em>{subValue}</em>}
    </article>
  );
}

function Status({ state }: { state: ApiState }) {
  if (!state.message) return null;
  return <p className={`status ${state.ok === false ? "bad" : state.ok ? "good" : ""}`}>{state.message}</p>;
}

createRoot(document.getElementById("root")!).render(<App />);
