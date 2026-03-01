// Server URL: same as page origin, or override with ?server=http://IP:3000
function getServerUrl() {
    const params = new URLSearchParams(window.location.search);
    const override = params.get("server");
    if (override) return override.replace(/\/$/, "");
    if (window.location.origin && (window.location.origin.startsWith("http://") || window.location.origin.startsWith("https://")))
        return window.location.origin;
    return "http://localhost:10000";
}
const SERVER_URL = getServerUrl();
// Use polling first for better compatibility, then upgrade to websocket
const socket = typeof io !== "undefined"
    ? io(SERVER_URL, { reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 2000, transports: ["polling", "websocket"] })
    : null;
if (!socket) {
    console.error("Socket.io not loaded. Open this page from the server URL (e.g. http://localhost:3000), not as a file.");
}

// Pages
const lobbyPage = document.getElementById("lobbyPage");
const conferencePage = document.getElementById("conferencePage");
const lobbyForm = document.getElementById("lobbyForm");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const roomDisplay = document.getElementById("roomDisplay");

const localVideo = document.getElementById("localVideo");
const remoteVideosContainer = document.getElementById("remoteVideosContainer");
const remoteStatus = document.getElementById("remoteStatus");
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const localDisplayNameEl = document.getElementById("localDisplayName");
const hostBadgeEl = document.getElementById("hostBadge");
const renameBtn = document.getElementById("renameBtn");
const shareScreenBtn = document.getElementById("shareScreenBtn");

let localStream = null;
let screenStream = null;
let currentRoomId = null;
let myDisplayName = "Participant";

// Show/hide pages
function showLobby() {
    lobbyPage.style.display = "flex";
    conferencePage.style.display = "none";
}

function showConference() {
    lobbyPage.style.display = "none";
    conferencePage.style.display = "flex";
}
let amHost = false;
/** peerId -> displayName */
const peerNames = new Map();
/** peerId -> { pc, pendingCandidates, videoEl, statusEl, box } */
const peerMap = new Map();

const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.relay.metered.ca:80" },
        {
            urls: "turn:global.relay.metered.ca:80",
            username: "0b68424087eca4949004b6aa",
            credential: "ox/368UgycEW2z9u",
        },
        {
            urls: "turn:global.relay.metered.ca:80?transport=tcp",
            username: "0b68424087eca4949004b6aa",
            credential: "ox/368UgycEW2z9u",
        },
        {
            urls: "turn:global.relay.metered.ca:443",
            username: "0b68424087eca4949004b6aa",
            credential: "ox/368UgycEW2z9u",
        },
        {
            urls: "turns:global.relay.metered.ca:443?transport=tcp",
            username: "0b68424087eca4949004b6aa",
            credential: "ox/368UgycEW2z9u",
        },
    ],
    iceTransportPolicy: "all",
};

// ——— Media & WebRTC ———
function getSendStream() {
    return screenStream || localStream;
}

async function getLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        return true;
    } catch (err) {
        console.error("getUserMedia error:", err);
        const name = err.name || "";
        const isInUse = name === "NotReadableError";
        let msg;
        if (isInUse || name === "NotReadableError") {
            msg = "Camera/microphone is in use.\n\nOn the same PC, only one browser or tab can use the camera at a time. Close the other tab (Edge or Chrome) that has the camera open, or test from a different PC/device.";
        } else if (window.location.protocol === "http:" && !window.location.hostname.match(/^localhost|127\./)) {
            msg = "Camera/microphone blocked. Browsers often require HTTPS when using an IP address.\n\n" +
              "Option 1: On the server PC run: npm run start:https (then open https://" + window.location.hostname + ":" + (window.location.port || "3000") + " and accept the certificate).\n\n" +
              "Option 2: Click the lock/info icon in the address bar and set Camera and Microphone to Allow, then refresh.";
        } else {
            msg = "Could not access camera/microphone. Check permissions (address bar → Site settings → Camera/Microphone → Allow). If another app or browser tab is using the camera, close it first.";
        }
        alert(msg);
        return false;
    }
}

function getPeerDisplayName(peerId) {
    return peerNames.get(peerId) || peerId.slice(0, 8);
}

function createRemoteVideoBox(peerId) {
    const name = getPeerDisplayName(peerId);
    const box = document.createElement("div");
    box.className = "video-box remote-peer";
    box.dataset.peerId = peerId;
    box.innerHTML = `
        <h3 class="peer-name">${escapeHtml(name)}</h3>
        <video autoplay playsinline></video>
        <p class="status">Connecting...</p>
    `;
    return box;
}

function updatePeerLabel(peerId) {
    const box = remoteVideosContainer.querySelector(`.video-box[data-peer-id="${peerId}"]`);
    if (box) {
        const h3 = box.querySelector(".peer-name");
        if (h3) h3.textContent = getPeerDisplayName(peerId);
    }
}

function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

function getOrCreatePeer(remoteId) {
    let entry = peerMap.get(remoteId);
    if (entry) return entry;

    const box = createRemoteVideoBox(remoteId);
    remoteVideosContainer.appendChild(box);
    const videoEl = box.querySelector("video");
    const statusEl = box.querySelector(".status");

    const pendingCandidates = [];
    const pc = new RTCPeerConnection(rtcConfig);

    getSendStream().getTracks().forEach((track) => {
        pc.addTrack(track, getSendStream());
    });

    pc.ontrack = (e) => {
        console.log("Got remote track from", remoteId, e.track.kind);
        if (videoEl.srcObject !== e.streams[0]) {
            videoEl.srcObject = e.streams[0];
            statusEl.textContent = "Connected";
        }
    };
    pc.onicecandidate = (e) => {
        if (e.candidate) {
            console.log("Sending ICE candidate to", remoteId, e.candidate.type);
            socket.emit("ice-candidate", { to: remoteId, room: currentRoomId, candidate: e.candidate });
        }
    };
    pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState, "for peer", remoteId);
        statusEl.textContent = pc.iceConnectionState;
        if (pc.iceConnectionState === "failed") {
            console.error("ICE connection failed, attempting restart...");
            statusEl.textContent = "Reconnecting...";
            pc.restartIce();
        }
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
            statusEl.textContent = "Connected";
        }
    };
    pc.onicegatheringstatechange = () => {
        console.log("ICE gathering state:", pc.iceGatheringState, "for peer", remoteId);
    };
    pc.onsignalingstatechange = () => {
        console.log("Signaling state:", pc.signalingState, "for peer", remoteId);
    };
    pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState, "for peer", remoteId);
        if (pc.connectionState === "connected") {
            statusEl.textContent = "Connected";
        } else if (pc.connectionState === "failed") {
            console.error("WebRTC connection failed with peer", remoteId);
            statusEl.textContent = "Failed - Retrying...";
            setTimeout(() => {
                console.log("Retrying connection to", remoteId);
                removePeer(remoteId);
                startCall(remoteId);
            }, 2000);
        }
    };

    entry = { pc, pendingCandidates, videoEl, statusEl, box };
    peerMap.set(remoteId, entry);
    updateRemoteStatusText();
    return entry;
}

function removePeer(remoteId) {
    const entry = peerMap.get(remoteId);
    if (!entry) return;
    entry.pc.close();
    if (entry.box && entry.box.parentNode) entry.box.remove();
    peerMap.delete(remoteId);
    updateRemoteStatusText();
}

function updateRemoteStatusText() {
    const n = peerMap.size;
    if (!remoteStatus) return;
    if (n === 0) {
        remoteStatus.textContent = "Waiting for peers... (multiple clients from different PCs)";
        remoteStatus.style.display = "block";
        remoteStatus.style.color = "";
    } else {
        remoteStatus.textContent = n + " peer" + (n === 1 ? "" : "s") + " connected";
        remoteStatus.style.display = "block";
        remoteStatus.style.color = "#8f8";
    }
}

async function drainPendingIceCandidates(entry) {
    while (entry.pendingCandidates.length) {
        const ice = entry.pendingCandidates.shift();
        try {
            await entry.pc.addIceCandidate(ice);
        } catch (err) {
            console.error("drain addIceCandidate error:", err);
        }
    }
}

async function startCall(remoteId) {
    const entry = getOrCreatePeer(remoteId);
    try {
        const offer = await entry.pc.createOffer();
        await entry.pc.setLocalDescription(offer);
        socket.emit("offer", { room: currentRoomId, to: remoteId, offer });
    } catch (err) {
        console.error("createOffer error:", err);
    }
}

async function handleOffer(fromId, offer) {
    const entry = getOrCreatePeer(fromId);
    try {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(offer));
        await drainPendingIceCandidates(entry);
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        socket.emit("answer", { to: fromId, room: currentRoomId, answer });
    } catch (err) {
        console.error("handleOffer error:", err);
    }
}

async function handleAnswer(fromId, answer) {
    const entry = peerMap.get(fromId);
    if (!entry) return;
    try {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(answer));
        await drainPendingIceCandidates(entry);
    } catch (err) {
        console.error("handleAnswer error:", err);
    }
}

async function handleIceCandidate(fromId, candidate) {
    if (!candidate) return;
    const ice = new RTCIceCandidate(candidate);
    let entry = peerMap.get(fromId);
    if (!entry) {
        entry = getOrCreatePeer(fromId);
        entry.pendingCandidates.push(ice);
        return;
    }
    if (entry.pc.remoteDescription) {
        try {
            await entry.pc.addIceCandidate(ice);
        } catch (err) {
            console.error("addIceCandidate error:", err);
        }
    } else {
        entry.pendingCandidates.push(ice);
    }
}

// ——— Room ———
async function joinRoom() {
    if (!socket) return;
    
    // Get name and room from lobby form
    const name = nameInput.value.trim();
    const roomId = roomInput.value.trim();
    
    if (!name || !roomId) {
        alert("Please enter both your name and a room ID.");
        return;
    }
    
    myDisplayName = name.slice(0, 32);
    if (localDisplayNameEl) localDisplayNameEl.textContent = myDisplayName;
    if (roomDisplay) roomDisplay.innerHTML = `Room: <strong>${roomId}</strong>`;

    const ok = await getLocalStream();
    if (!ok) return;

    currentRoomId = roomId;
    socket.emit("join-room", { roomId, displayName: myDisplayName });
    
    // Switch to conference page
    showConference();
    
    leaveBtn.disabled = false;
    chatInput.disabled = false;
    sendBtn.disabled = false;
    if (renameBtn) renameBtn.style.display = "";
    updateMuteButton();
    updateCameraButton();
    updateShareScreenButton();
}

function leaveRoom() {
    stopScreenShare();
    if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
    }
    localVideo.srcObject = null;
    peerMap.forEach((entry, id) => removePeer(id));
    peerNames.clear();
    if (socket && currentRoomId) {
        socket.emit("leave-room", currentRoomId);
        currentRoomId = null;
    }
    
    // Go back to lobby
    showLobby();
    
    leaveBtn.disabled = true;
    chatInput.disabled = true;
    sendBtn.disabled = true;
    if (renameBtn) renameBtn.style.display = "none";
    if (hostBadgeEl) hostBadgeEl.style.display = "none";
    remoteStatus.textContent = "Waiting for others…";
    remoteStatus.style.display = "block";
    
    // Clear chat
    if (chatMessages) chatMessages.innerHTML = "";
}

// ——— Mute / Camera ———
function updateMuteButton() {
    if (!muteBtn || !localStream) return;
    const audio = localStream.getAudioTracks()[0];
    const on = audio && audio.enabled;
    const iconOn = muteBtn.querySelector(".icon-mic-on");
    const iconOff = muteBtn.querySelector(".icon-mic-off");
    const label = muteBtn.querySelector(".btn-label");
    if (iconOn) iconOn.hidden = !on;
    if (iconOff) iconOff.hidden = on;
    if (label) label.textContent = on ? "Mute" : "Unmute";
}

function updateCameraButton() {
    if (!cameraBtn || !localStream) return;
    const video = localStream.getVideoTracks()[0];
    const on = video && video.enabled;
    const iconOn = cameraBtn.querySelector(".icon-camera-on");
    const iconOff = cameraBtn.querySelector(".icon-camera-off");
    const label = cameraBtn.querySelector(".btn-label");
    if (iconOn) iconOn.hidden = !on;
    if (iconOff) iconOff.hidden = on;
    if (label) label.textContent = on ? "Camera Off" : "Camera On";
}

function toggleMute() {
    if (!localStream) return;
    const audio = localStream.getAudioTracks()[0];
    if (!audio) return;
    audio.enabled = !audio.enabled;
    updateMuteButton();
}

function toggleCamera() {
    if (screenStream) return;
    if (!localStream) return;
    const video = localStream.getVideoTracks()[0];
    if (!video) return;
    video.enabled = !video.enabled;
    updateCameraButton();
}

function replaceVideoTrackOnAllPeers(newTrack) {
    peerMap.forEach((entry) => {
        const sender = entry.pc.getSenders().find((s) => s.track && s.track.kind === "video");
        if (sender) sender.replaceTrack(newTrack);
    });
}

function updateShareScreenButton() {
    if (!shareScreenBtn) return;
    const label = shareScreenBtn.querySelector(".btn-label");
    if (label) label.textContent = screenStream ? "Stop Share" : "Share Screen";
    shareScreenBtn.classList.toggle("active", !!screenStream);
}

async function startScreenShare() {
    if (screenStream) return;
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const screenVideo = screenStream.getVideoTracks()[0];
        if (screenVideo) {
            localVideo.srcObject = screenStream;
            replaceVideoTrackOnAllPeers(screenVideo);
            screenVideo.onended = stopScreenShare;
        }
        updateShareScreenButton();
    } catch (err) {
        console.error("getDisplayMedia error:", err);
        alert("Could not share screen. You may have cancelled or the browser denied permission.");
    }
}

function stopScreenShare() {
    if (!screenStream) return;
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    if (localStream) {
        localVideo.srcObject = localStream;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) replaceVideoTrackOnAllPeers(videoTrack);
    }
    updateShareScreenButton();
}

function doRename() {
    const name = prompt("Enter your display name:", myDisplayName);
    if (name === null) return;
    if (!name.trim()) return;
    myDisplayName = name.trim().slice(0, 32);
    if (localDisplayNameEl) localDisplayNameEl.textContent = myDisplayName;
    if (socket) socket.emit("set-display-name", { name: myDisplayName });
}

// ——— Chat ———
function sendChatMessage() {
    if (!socket) return;
    const text = chatInput.value.trim();
    if (!text || !currentRoomId) return;
    socket.emit("chat-message", { room: currentRoomId, message: text });
    chatInput.value = "";
}

function appendMessage(text, fromId, displayName, isSelf, isHost) {
    const div = document.createElement("div");
    div.className = "msg " + (isSelf ? "self" : "remote");
    const nameLine = document.createElement("div");
    nameLine.className = "msg-name";
    nameLine.textContent = isSelf ? "You" : (displayName + (isHost ? " (Host)" : ""));
    const textLine = document.createElement("div");
    textLine.className = "msg-text";
    textLine.textContent = text;
    const timeLine = document.createElement("div");
    timeLine.className = "msg-time";
    timeLine.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    div.appendChild(nameLine);
    div.appendChild(textLine);
    div.appendChild(timeLine);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ——— Socket ———
if (socket) {
    socket.on("connect", () => {
        console.log("Connected to signaling server at", SERVER_URL);
    });

    socket.on("connect_error", (err) => {
        console.error("Socket connect error:", err);
    });

    socket.on("room-joined", ({ isHost }) => {
        amHost = isHost;
        if (hostBadgeEl) hostBadgeEl.style.display = amHost ? "" : "none";
    });

    socket.on("existing-peers", (peers) => {
        peers.forEach((p) => {
            peerNames.set(p.id, p.displayName);
            startCall(p.id);
        });
    });

    socket.on("user-joined", (data) => {
        const id = typeof data === "string" ? data : data.id;
        const displayName = typeof data === "object" && data.displayName ? data.displayName : id.slice(0, 8);
        peerNames.set(id, displayName);
        console.log("Peer joined:", id, displayName);
        // Don't start call here - wait for the new peer to call us via existing-peers
        // This prevents both peers from calling each other simultaneously
    });

    socket.on("user-renamed", ({ id, displayName }) => {
        peerNames.set(id, displayName);
        updatePeerLabel(id);
    });

    socket.on("offer", async ({ from, offer }) => {
        console.log("Received offer from", from);
        // Create peer if doesn't exist (new joiner calling us)
        if (!peerMap.has(from)) {
            getOrCreatePeer(from);
        }
        await handleOffer(from, offer);
    });

    socket.on("answer", ({ from, answer }) => {
        console.log("Received answer from", from);
        handleAnswer(from, answer);
    });

    socket.on("ice-candidate", ({ from, candidate }) => {
        console.log("Received ICE candidate from", from);
        handleIceCandidate(from, candidate);
    });

    socket.on("chat-message", ({ from, displayName, isHost, message }) => {
        appendMessage(message, from, displayName || from.slice(0, 8), from === socket.id, isHost);
    });

    socket.on("user-left", (data) => {
        const peerId = typeof data === "string" ? data : data.id;
        removePeer(peerId);
    });
}

// ——— UI ———
// Handle lobby form submission
lobbyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    joinRoom();
});

leaveBtn.addEventListener("click", leaveRoom);
muteBtn.addEventListener("click", toggleMute);
cameraBtn.addEventListener("click", toggleCamera);
if (shareScreenBtn) shareScreenBtn.addEventListener("click", () => (screenStream ? stopScreenShare() : startScreenShare()));
if (renameBtn) renameBtn.addEventListener("click", doRename);
sendBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChatMessage();
});
