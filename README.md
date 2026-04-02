# 🎥 VisionPrime – Real-Time Video Conferencing Application

A real-time video conferencing web application built using WebRTC and Socket.IO, enabling seamless peer-to-peer communication for video, audio, and chat without additional plugins.

---

## 🚀 Live Demo
🔗 Live Application: https://videostreaming-1.onrender.com  

🎥 Demo Videos:  
https://youtu.be/jsqqbaB-5hk  
https://youtu.be/mq5b-UhOWpo  

---

## 📌 Project Overview

This project demonstrates a browser-based real-time communication system using WebRTC technology. It allows users to join a meeting room and interact through video, audio, and text chat efficiently.

Unlike traditional systems, this application uses peer-to-peer communication, reducing server load and latency.

---

## 🎯 Objectives

- Enable real-time video and audio communication  
- Implement peer-to-peer communication using WebRTC  
- Provide real-time chat functionality  
- Allow media controls (mute/unmute, camera toggle)  
- Build a browser-accessible communication platform  
- Demonstrate efficient real-time networking  

---

## ✨ Features

- Real-time video streaming  
- Real-time audio communication  
- Live chat messaging  
- Mute / Unmute microphone  
- Camera enable / disable  
- Screen sharing  
- Participant list display  
- Meeting room system  

---

## 🏗️ System Architecture

The system follows a hybrid architecture:

### Client Application
- Built using HTML, CSS, JavaScript  
- Handles UI and user interactions  
- Captures media and manages connections  

### Signaling Server
- Built with Node.js and Socket.IO  
- Manages rooms and exchanges signaling data  

### Peer-to-Peer Communication
- WebRTC establishes direct communication  
- Handles video/audio streaming  

The server only coordinates connections — media flows directly between users.

---

## 🔄 System Workflow

1. User opens the application  
2. Enters a room ID  
3. Grants camera & microphone permissions  
4. Client connects to signaling server  
5. Server exchanges signaling data  
6. WebRTC establishes peer connection  
7. Media streams are shared  
8. Users can chat and control media  
9. Connection ends when user leaves  

---

## 🛠️ Tech Stack

### Frontend
- HTML  
- CSS  
- JavaScript  
- WebRTC APIs  

### Backend
- Node.js  
- Express.js  
- Socket.IO  

---

🤖 Use of AI Tools

AI tools like ChatGPT were used to:

Understand WebRTC concepts
Debug issues
Improve code structure and documentation
👨‍💻 Authors
Pugalini M. (2022/E/098)
Sanas M. M. (2022/E/099)
Rathini R. (2022/E/115)
📄 License

This project is developed for academic purposes.
