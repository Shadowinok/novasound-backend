import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { playlists as playlistsApi } from '../api/client';
import { coverImageBackgroundStyle } from '../utils/coverImage';

export default function Playlists() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');

  useEffect(() => {
    playlistsApi.list().then((r) => setList(r.data || [])).catch(() => []).finally(() => setLoading(false));
  }, []);

  const query = search.trim().toLowerCase();
  const filtered = list
    .filter((p) => {
      if (!query) return true;
      const title = String(p.title || '').toLowerCase();
      const desc = String(p.description || '').toLowerCase();
      const author = String(p.createdBy?.username || '').toLowerCase();
      return title.includes(query) || desc.includes(query) || author.includes(query);
    })
    .sort((a, b) => {
      if (sort === 'oldest') return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      if (sort === 'title-asc') return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
      if (sort === 'title-desc') return String(b.title || '').localeCompare(String(a.title || ''), 'ru');
      if (sort === 'tracks-desc') return (Array.isArray(b.tracks) ? b.tracks.length : 0) - (Array.isArray(a.tracks) ? a.tracks.length : 0);
      if (sort === 'tracks-asc') return (Array.isArray(a.tracks) ? a.tracks.length : 0) - (Array.isArray(b.tracks) ? b.tracks.length : 0);
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="page playlists-page">
      <h2 className="page-title">Плейлисты</h2>
      <p className="playlists-lead">
        Подборки редакции NovaSound. Собрать свой список можно в личном кабинете.
      </p>
      <div className="playlists-toolbar">
        <input
          type="search"
          className="playlists-search"
          placeholder="Поиск: название, описание, автор..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="playlists-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Сначала новые</option>
          <option value="oldest">Сначала старые</option>
          <option value="title-asc">Название (А-Я)</option>
          <option value="title-desc">Название (Я-А)</option>
          <option value="tracks-desc">Больше треков</option>
          <option value="tracks-asc">Меньше треков</option>
        </select>
        <button
          type="button"
          className="playlists-reset"
          onClick={() => {
            setSearch('');
            setSort('newest');
          }}
        >
          Сброс
        </button>
      </div>
      {loading ? (
        <div className="loading">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="empty">Плейлистов пока нет</div>
      ) : (
        <div className="playlist-grid">
          {filtered.map((p) => (
            <Link key={p._id} to={`/playlist/${p._id}`} className="playlist-card">
              <div
                className="playlist-cover"
                style={coverImageBackgroundStyle(p.coverImage, p.updatedAt)}
              />
              <span className="playlist-title">{p.title}</span>
              {p.description && <span className="playlist-desc">{p.description}</span>}
              <span className="playlist-meta">
                Треков: {Array.isArray(p.tracks) ? p.tracks.length : 0}
              </span>
            </Link>
          ))}
        </div>
      )}
      <style>{`
        .playlists-page {
          max-width: 1100px;
          margin: 0 auto;
          padding-left: 280px;
          padding-right: 24px;
        }
        .page-title { color: var(--neon-cyan); margin-bottom: 12px; }
        .playlists-lead {
          color: var(--text-dim);
          font-size: 0.95rem;
          line-height: 1.45;
          max-width: 560px;
          margin: 0 0 24px;
        }
        .playlists-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
          margin-bottom: 18px;
        }
        .playlists-search, .playlists-sort {
          padding: 10px 12px;
          border: 1px solid rgba(5, 217, 232, 0.4);
          border-radius: 8px;
          background: rgba(0,0,0,0.3);
          color: var(--text);
        }
        .playlists-search { width: min(100%, 380px); }
        .playlists-sort { min-width: 200px; }
        .playlists-reset {
          padding: 10px 12px;
          border: 1px solid rgba(255, 42, 109, 0.5);
          border-radius: 8px;
          background: transparent;
          color: var(--neon-pink);
        }
        .playlists-reset:hover { background: rgba(255, 42, 109, 0.12); }
        .playlist-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 24px;
        }
        .playlist-card {
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(211, 0, 197, 0.3);
          text-decoration: none;
          color: inherit;
        }
        .playlist-card:hover { box-shadow: 0 0 25px rgba(211, 0, 197, 0.4); }
        .playlist-cover { aspect-ratio: 1; background-size: cover; background-position: center; }
        .playlist-title { display: block; padding: 12px; font-family: var(--font-display); color: var(--neon-cyan); }
        .playlist-desc { display: block; padding: 0 12px 12px; font-size: 0.85rem; color: var(--text-dim); }
        .playlist-meta { display: block; padding: 0 12px 12px; font-size: 0.78rem; color: var(--text-dim); }
        .loading, .empty { text-align: center; padding: 48px; color: var(--text-dim); }
        @media (max-width: 900px) {
          .playlists-page { padding-left: 0; padding-right: 0; }
        }
      `}</style>
    </motion.div>
  );
}
