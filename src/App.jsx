import React, { useState, useRef } from 'react';
import { io } from 'socket.io-client';
import 'bootstrap/dist/css/bootstrap.min.css';

function App() {
  const [url, setUrl] = useState('');
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const socketRef = useRef(null);
  const markdownsRef = useRef([]);

  const formatPlan = (planItems, indentLevel = 0) => {
    const indent = "  ".repeat(indentLevel);
    const output = [];

    if (Array.isArray(planItems)) {
      for (const item of planItems) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const status = item.status ?? 'Unknown'; // Nullish coalescing
          const desc = item.description ?? 'No description';
          const result = item.result ?? '';
          const mark = item.mark ?? ''; // For verification etc.

          let statusIcon = '';
          if (status.toLowerCase() === 'done') {
            statusIcon = '✅';
          } else if (status.toLowerCase() === 'pending') {
            statusIcon = '⏳';
          } else if (status.toLowerCase() === 'running') {
            statusIcon = '🏃'; // Or use '🔄' for in-progress
          } else {
            statusIcon = '❔'; // Optional: For unknown status
          }

          // Format the main step line
          let line = `${indent}- [${statusIcon}] ${desc}`;
          if (result) {
            line += `: ${result}`;
          }
          if (mark) {
            line += ` (${mark})`;
          }
          output.push(line);

          // Recursively format sub-steps if they exist
          const subSteps = item.sub_steps; // Assuming key is 'sub_steps'
          if (subSteps && Array.isArray(subSteps)) { // Check if subSteps is an array
            output.push(formatPlan(subSteps, indentLevel + 1));
          }
        } else if (typeof item === 'string') { // Basic fallback for string items
          output.push(`${indent}- ${item}`);
        } else { // Fallback for unexpected types
          output.push(`${indent}- ${String(item)}`);
        }
      }
    } else if (typeof planItems === 'string') { // Handle case where plan is just an error string
      output.push(`${indent}${planItems}`);
    } else {
      output.push(`${indent}# Invalid plan format: ${typeof planItems}`);
    }

    return output.join("\n");
  }


  const connectSocket = () => {
    if (!url) return;
    socketRef.current = io(url, { transports: ['websocket'] });

    socketRef.current.on('connect', () => {
      console.log(`Connected to namespace: ${socketRef.current.nsp}`);
      setConnected(true);
    });

    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    socketRef.current.on('connect_error', (err) => {
      console.error('Connection error:', err);
    });

    socketRef.current.on('event', async ({ event, data }) => {
      console.log('Message from server:', event, data);


      let markdown;
      switch (event) {
        case 'input:waiting':
          markdown = '';
          markdown += data.message ?? 'Waiting for user input...';
          break;
        case 'analyse:started':
          markdown = '';
          markdown += `🔍 Objective: ${data.objective}`;

          markdownsRef.current.push(markdown);
          setMessages([...markdownsRef.current]);
          break;
        case 'analyse:completed':
          markdown = '';
          markdown += data.response.mode === 'plan'
            ? `🧠 Thinking: ${data.objective}`
            : `💭 Thinking: ${data.objective}`;

          markdownsRef.current.push(markdown);
          setMessages([...markdownsRef.current]);
          break;
        case 'explain:completed':
          markdown = '';
          markdown += `🎯 Explain Completed: ${data.objective}\n\n**Summary:** ${data.response.summary}\n**Explanation:** ${data.response.explanation}`;
          markdownsRef.current.push(markdown);
          setMessages([...markdownsRef.current]);

          break;
        case 'cot:thought':
          markdown = '';
          // Extract thought number and content (assuming execRes contains these)
          const thoughtNum = data.response.thought_number ?? 'unknown'; // or get from execRes
          const currentThinking = data.response.current_thinking ?? 'Error: Missing thinking content.';
          const currentRunning = data.response.current_running ?? null;

          const planList = data.response.planning ?? ["Error: Planning data missing."];
          const planStrFormatted = formatPlan(planList, 1); // indent_level = 1



          // Termination check using is_conclusion or next_thought_needed flags
          if (!(data.response.next_thought_needed ?? true)) { // Primary termination signal               
            const summary = data.response.summary ?? 'No summary provided';


            markdown += `🤔 Final Plan Status (Thought ${thoughtNum}):\n${planStrFormatted}\n\n`;
            markdown += `Summary:\n\n${summary}\n\n`;
            if (markdownsRef.current.length > 0 && markdownsRef.current[markdownsRef.current.length - 1].includes('Plan Status')) {
              markdownsRef.current[markdownsRef.current.length - 1] = markdown;
            } else {
              markdownsRef.current.push(markdown);
            }
            setMessages([...markdownsRef.current]);
            return;// Signal termination
          }

          markdown += `🤔 Current Plan Status (Thought ${thoughtNum}):\n${planStrFormatted}\n\n`;
          if (markdownsRef.current.length > 0 && markdownsRef.current[markdownsRef.current.length - 1].includes('Plan Status')) {
            markdownsRef.current[markdownsRef.current.length - 1] = markdown;
          } else {
            markdownsRef.current.push(markdown);
          }

          setMessages([...markdownsRef.current]);
          break;
        case 'error:occurred':
        case 'objective:error':
          markdown = '';
          markdown += `❌ Error: ${JSON.stringify(data.error)}`;

          markdownsRef.current.push(markdown);
          setMessages([...markdownsRef.current]);
          break;
        default:
          markdown = '';
          markdown += JSON.stringify(data);

          markdownsRef.current.push(markdown);
          setMessages([...markdownsRef.current]);
      }


    });
  };

  const sendMessage = () => {
    if (inputValue && socketRef.current) {
      socketRef.current.emit('event', { event: 'objective:run', data: { objective: inputValue } });
      //markdownsRef.current.push(`You: ${inputValue}`);
      setMessages([...markdownsRef.current]);
      setInputValue('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!connected) {
        connectSocket();
      } else {
        sendMessage();
      }
    }
  };

  return (
    <div className="container py-4">
      <div className="card shadow-sm p-4 mx-auto" style={{ maxWidth: '900px', width: '100%' }}>
        {!connected && (
          <div className="mb-3">
            <h4 className="mb-3">Connect to Yeomen App</h4>
            <div className="input-group">
              <input
                type="text"
                className="form-control"
                placeholder="Enter URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button className="btn btn-primary" onClick={connectSocket}>Connect</button>
            </div>
          </div>
        )}

        {connected && (
          <>
            <div className="mb-3">
              <h4 className="mb-3 text-success">Connected to Yeomen App</h4>
              <div className="input-group mb-3">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Enter message"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button className="btn btn-success" onClick={sendMessage}>Send Message</button>
              </div>
            </div>
            <div className="mt-4">
              <h5>Messages:</h5>
              <div className="border rounded p-3" style={{ height: '400px', overflowY: 'auto', backgroundColor: '#f8f9fa' }}>
                {messages.map((msg, idx) => (
                  <pre key={idx} className="mb-2 p-2 bg-white rounded shadow-sm" style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>{msg}</pre>
                ))}
              </div>
            </div>
          </>
        )}


      </div>
    </div>
  );
}

export default App;
