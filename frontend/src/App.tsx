import { useState, useEffect, useRef } from 'react'
import './App.css'

type Mode = 'transcribe' | 'clone';

function App() {
  const [aiStatus, setAiStatus] = useState("Connecting...")
  const [mode, setMode] = useState<Mode>('transcribe')
  const [isRecording, setIsRecording] = useState(false)
  const [targetText, setTargetText] = useState("Hello, this is my cloned voice speaking from a Docker container.")
  const [resultText, setResultText] = useState("")
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const audioChunks = useRef<Blob[]>([])

  useEffect(() => {
    fetch('http://localhost:8000/')
      .then(res => res.json())
      .then(data => {
        const statusStr = `STT: ${data.features.transcription} | TTS: ${data.features.voice_cloning}`;
        setAiStatus(statusStr);
      })
      .catch(() => setAiStatus("AI Engine Offline"));
  }, [])

  const startRecording = async () => {
    setResultText("");
    setAudioUrl(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder.current = new MediaRecorder(stream);
    audioChunks.current = [];

    mediaRecorder.current.ondataavailable = (event) => {
      audioChunks.current.push(event.data);
    };

    mediaRecorder.current.onstop = async () => {
      const audioBlob = new Blob(audioChunks.current, { type: 'audio/wav' });
      if (mode === 'transcribe') {
        handleTranscribe(audioBlob);
      } else {
        handleClone(audioBlob);
      }
    };

    mediaRecorder.current.start();
    setIsRecording(true);
  }

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setIsRecording(false);
  }

  // Feature 1: Send to Whisper
  const handleTranscribe = async (blob: Blob) => {
    setResultText("Transcribing...");
    const formData = new FormData();
    formData.append('file', blob, 'speech.wav');

    try {
      const response = await fetch('http://localhost:8000/transcribe', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      setResultText(data.text || "Could not transcribe.");
    } catch (err) {
      setResultText("Error connecting to AI Engine.");
    }
  };

  // Feature 2: Send to XTTS v2 for Cloning
  const handleClone = async (blob: Blob) => {
    setResultText("Cloning voice and generating speech...");
    const formData = new FormData();
    formData.append('file', blob, 'reference.wav');
    formData.append('text', targetText);

    try {
      const response = await fetch('http://localhost:8000/clone-voice', {
        method: 'POST',
        body: formData,
      });
      
      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
      setResultText("Success! Cloned audio generated.");
      
      // Auto-play the result
      const audio = new Audio(url);
      audio.play();
    } catch (err) {
      setResultText("Cloning failed.");
    }
  };

  return (
    <div className="App">
      <header>
        <h1>VoiceSaaS AI</h1>
        <div className={`status-badge ${aiStatus.includes('Offline') ? 'offline' : 'online'}`}>
          {aiStatus}
        </div>
      </header>

      <div className="mode-toggle">
        <button 
          className={mode === 'transcribe' ? 'active' : ''} 
          onClick={() => setMode('transcribe')}
        >
          Transcription Mode
        </button>
        <button 
          className={mode === 'clone' ? 'active' : ''} 
          onClick={() => setMode('clone')}
        >
          Voice Cloning Mode
        </button>
      </div>

      <main className="container">
        {mode === 'clone' && (
          <div className="clone-setup">
            <div className="prompt-card">
              <h3>Step 1: Read this script clearly:</h3>
              <p className="script-text">
                "The quick brown fox jumps over the lazy dog. My voice is being captured to create a digital clone for high-quality synthesis."
              </p>
            </div>
            <div className="input-group">
              <h3>Step 2: What should the clone say?</h3>
              <textarea 
                value={targetText} 
                onChange={(e) => setTargetText(e.target.value)}
                placeholder="Enter text for the AI to speak..."
              />
            </div>
          </div>
        )}

        <div className="controls">
          <button 
            onClick={isRecording ? stopRecording : startRecording}
            className={`mic-button ${isRecording ? 'is-recording' : ''}`}
          >
            {isRecording ? "Stop & Process" : `Start ${mode === 'clone' ? 'Recording' : 'Transcribing'}`}
          </button>
        </div>

        {resultText && (
          <div className="result-area">
            <h4>Output:</h4>
            <p>{resultText}</p>
            {audioUrl && (
              <div className="audio-player">
                <audio src={audioUrl} controls />
                <a href={audioUrl} download="cloned_voice.wav">Download Voice</a>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

export default App