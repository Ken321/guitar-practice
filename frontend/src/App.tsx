import { Routes, Route, Link } from 'react-router-dom'
import SongList from './pages/SongList'
import ChordSheet from './pages/ChordSheet'
import AddSong from './pages/AddSong'

function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}>
        <Link to="/" style={{ color: 'var(--theme-color)', fontSize: '20px', fontWeight: 'bold', textDecoration: 'none' }}>
          🎸 Guitar Chord Practice
        </Link>
      </header>
      <main style={{ flex: 1, padding: '0' }}>
        <Routes>
          <Route path="/" element={<SongList />} />
          <Route path="/add" element={<AddSong />} />
          <Route path="/songs/:id" element={<ChordSheet />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
