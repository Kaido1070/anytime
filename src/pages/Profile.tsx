import { useLibrary } from "../hooks/useLibrary";
export function Profile() {
  const { user, data, signOut } = useLibrary();
  const reading = new Set(
    Object.values(data?.progress ?? {})
      .filter((p) => !data?.completed.includes(`${p.mangaId}:${p.chapter}`))
      .map((p) => p.mangaId),
  ).size;
  return (
    <>
      <p className="eyebrow">YOUR READING ROOM</p>
      <h1>
        Profile<span className="accent">.</span>
      </h1>
      <div className="profile-heading">
        <span className="avatar profile-avatar">{user?.name[0]}</span>
        <h2>{user?.name}</h2>
        <p className="muted">@{user?.username}</p>
      </div>
      <div className="stats">
        <div>
          <strong>{data?.favorites.length ?? 0}</strong>
          <span>Favorites</span>
        </div>
        <div>
          <strong>{reading}</strong>
          <span>Currently reading</span>
        </div>
      </div>
      <div className="profile-info">
        <p>
          <span>Display name</span>
          <b>{user?.name}</b>
        </p>
        <p>
          <span>Username</span>
          <b>@{user?.username}</b>
        </p>
        <p>
          <span>Your library</span>
          <b>Saved on this device</b>
        </p>
      </div>
      <button className="secondary signout" onClick={signOut}>
        Sign out <span>↗</span>
      </button>
      <p className="demo-note">
        PHASE 01
        <br />
        <span>A private prototype. Mock accounts and local reading data.</span>
      </p>
    </>
  );
}
