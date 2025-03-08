class TalkRecorderApp extends HTMLElement {
  constructor() {
    super();
    this.audioChunks = [];
    this.recordings = [];
    this.chats = [];
    this.owner = "";
    this.directoryHandle = null;
    this.permissionsGranted =
      localStorage.getItem("permissionsGranted") === "true";
    this.attachShadow({ mode: "open" });
    this.init();
  }

  async init() {
    if (this.permissionsGranted && "showDirectoryPicker" in window) {
      await this.revalidatePermissions();
    }
    if (!this.directoryHandle) {
      this.showPermissionsModal();
    } else {
      this.render();
      this.setupSpeechRecognition();
      this.setupMediaRecorder();
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 90vw;
                    max-width: 600px;
                    margin: 20px auto;
                    padding: var(--padding);
                    background-color: var(--background-color);
                    color: var(--text-color);
                }
                .container {
                    display: flex;
                    gap: 20px;
                }
                .chat-window, .recordings-list {
                    border: 1px solid var(--border-color);
                    padding: var(--padding);
                    margin-bottom: 10px;
                    flex: 1;
                }
                textarea {
                    width: 100%;
                    box-sizing: border-box;
                }
                .controls {
                    display: flex;
                    gap: 10px;
                    margin-top: 10px;
                }
                button {
                    padding: 5px 10px;
                    background: var(--button-bg);
                    color: white;
                    border: none;
                    cursor: pointer;
                }
                button:hover {
                    background: var(--button-hover);
                }
                .recording-indicator {
                    color: red;
                    font-weight: bold;
                    display: none;
                }
                .recording-indicator.active {
                    display: inline;
                }
                ul {
                    list-style: none;
                    padding: 0;
                }
                li {
                    margin: 5px 0;
                    display: flex;
                    gap: 10px;
                    align-items: center;
                }
                .modal {
                    display: none;
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    justify-content: center;
                    align-items: center;
                }
                .modal-content {
                    background: var(--background-color);
                    padding: 20px;
                    border: 1px solid var(--border-color);
                    color: var(--text-color);
                    width: 300px;
                }
                .modal-content input {
                    width: 100%;
                    padding: 5px;
                    margin: 10px 0;
                }
                .modal-content button {
                    margin: 5px;
                }
                .chat-list {
                    flex: 1;
                }
            </style>
        <div class="container">
            <div class="chat-list">
                <h2>Chats</h2>
                <ul id="chat-list"></ul>
            </div>
            <div class="chat-window">
                <h2>Transcripción de Voz</h2>
                <textarea id="chat-text" rows="10" readonly aria-label="Transcripción de voz"></textarea>
                <div class="controls">
                    <button class="start-record-btn">🎤</button>
                    <button class="stop-record-btn" disabled>🛑</button>
                    <span class="recording-indicator">Grabando...</span>
                    <button class="copy-btn">📋</button>
                    <button class="export-pdf-btn">🖨️</button>
                    <button class="new-chat-btn">➕</button>
                </div>
            </div>
        </div>
        <div class="recordings-list">
            <h2>Grabaciones</h2>
            <input type="file" id="load-recording" accept="audio/webm" />
            <ul id="recordings"></ul>
        </div>
        <div class="modal" id="permissions-modal">
            <div class="modal-content">
                <h3>Configuración inicial</h3>
                <p>Se necesitan permisos para el micrófono y una carpeta. Selecciona la misma carpeta tras reinstalar para restaurar tu historial.</p>
                <label for="owner-name">Nombre del propietario:</label>
                <input type="text" id="owner-name" placeholder="Ej: Juan Pérez" />
                <button id="grant-permissions-btn">Otorgar permisos</button>
            </div>
        </div>
        <div class="modal" id="naming-modal">
            <div class="modal-content">
                <h3>Nombre del archivo</h3>
                <input type="text" id="file-name" placeholder="Ej: mi_grabacion" />
                <button id="save-file-btn">Guardar</button>
                <button id="cancel-file-btn">Cancelar</button>
            </div>
        </div>
        `;
    this.updateRecordingsList();
    this.setupEventListeners();
  }

  async showPermissionsModal() {
    this.render();
    const modal = this.shadowRoot.getElementById("permissions-modal");
    modal.style.display = "flex";
  }

  async grantPermissions() {
    const ownerInput = this.shadowRoot
      .getElementById("owner-name")
      .value.trim();
    if (!ownerInput) {
      alert("Por favor, ingresa un nombre para el propietario.");
      return;
    }
    this.owner = ownerInput;

    // Solicitar acceso al micrófono
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert("Error al acceder al micrófono: " + err.message);
      return;
    }

    // Solicitar acceso a la carpeta
    if ("showDirectoryPicker" in window) {
      try {
        this.directoryHandle = await window.showDirectoryPicker({
          mode: "readwrite",
        });
        localStorage.setItem("permissionsGranted", "true");
        await this.loadDataFromJson();
        this.shadowRoot.getElementById("permissions-modal").style.display =
          "none";
        this.setupSpeechRecognition();
        this.setupMediaRecorder();
      } catch (err) {
        alert("Error al seleccionar la carpeta: " + err.message);
      }
    } else {
      alert(
        "Este navegador no soporta acceso a carpetas. Los archivos se descargarán manualmente."
      );
      this.shadowRoot.getElementById("permissions-modal").style.display =
        "none";
      this.setupSpeechRecognition();
      this.setupMediaRecorder();
    }
  }

  async revalidatePermissions() {
    if ("showDirectoryPicker" in window) {
      try {
        const permissionStatus = await this.directoryHandle.queryPermission({
          mode: "readwrite",
        });
        if (permissionStatus !== "granted") {
          await this.directoryHandle.requestPermission({ mode: "readwrite" });
        }
        if (
          (await this.directoryHandle.requestPermission({
            mode: "readwrite",
          })) === "granted"
        ) {
          await this.loadDataFromJson();
          this.render();
        } else {
          this.directoryHandle = null;
          localStorage.removeItem("permissionsGranted");
          this.showPermissionsModal();
        }
      } catch (err) {
        this.directoryHandle = null;
        localStorage.removeItem("permissionsGranted");
        this.showPermissionsModal();
      }
    }
  }

  setupSpeechRecognition() {
    const recognition = new (window.SpeechRecognition ||
      window.webkitSpeechRecognition)();
    recognition.lang = "es-ES";
    recognition.continuous = true;
    let ultimoMensaje = "";

    recognition.onresult = (event) => {
      const resultados = event.results;
      const indiceUltimoResultado = resultados.length - 1;
      const transcript = resultados[indiceUltimoResultado][0].transcript.trim();

      if (transcript !== ultimoMensaje) {
        ultimoMensaje = transcript;
        const chatText = this.shadowRoot.getElementById("chat-text");
        chatText.value += transcript + "\n";
        chatText.scrollTop = chatText.scrollHeight;
        this.chats.push({
          text: transcript,
          timestamp: new Date().toISOString(),
        });
        this.saveDataToJson();
      }
    };

    recognition.onerror = (event) =>
      console.error("Error en Speech Recognition:", event.error);

    recognition.onend = () => {
      setTimeout(() => {
        recognition.start();
      }, 1000); // Añadir un pequeño retraso para evitar bucles
    };

    recognition.start();
  }

  setupMediaRecorder() {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        this.mediaRecorder = new MediaRecorder(stream, {
          mimeType: "audio/webm",
        });
        this.mediaRecorder.ondataavailable = (event) =>
          this.audioChunks.push(event.data);
        this.mediaRecorder.onstop = () => this.showNamingModal();
      })
      .catch((err) => console.error("Error al acceder al micrófono:", err));
  }

  setupEventListeners() {
    this.shadowRoot.addEventListener("click", (e) => {
      const chatText = this.shadowRoot.getElementById("chat-text");
      if (e.target.matches(".start-record-btn")) {
        this.startRecording();
      } else if (e.target.matches(".stop-record-btn")) {
        this.stopRecording();
      } else if (e.target.matches(".copy-btn")) {
        navigator.clipboard
          .writeText(chatText.value)
          .then(() => console.log("Texto copiado"));
      } else if (e.target.matches(".export-pdf-btn")) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.text(chatText.value, 10, 10);
        doc.save("chat.pdf");
      } else if (e.target.matches(".new-chat-btn")) {
        chatText.value = "";
      } else if (e.target.matches("#grant-permissions-btn")) {
        this.grantPermissions();
      } else if (e.target.matches("#save-file-btn")) {
        this.saveRecordingWithName();
      } else if (e.target.matches("#cancel-file-btn")) {
        this.hideNamingModal();
      } else if (e.target.matches(".play-recording-direct")) {
        const fileName = e.target.dataset.fileName;
        this.playRecordingDirect(fileName);
      }
    });

    this.shadowRoot
      .querySelector("#load-recording")
      .addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
          const url = URL.createObjectURL(file);
          const audio = new Audio(url);
          audio.play();
        }
      });
  }

  startRecording() {
    this.audioChunks = [];
    this.mediaRecorder.start();
    this.shadowRoot.querySelector(".start-record-btn").disabled = true;
    this.shadowRoot.querySelector(".stop-record-btn").disabled = false;
    this.shadowRoot
      .querySelector(".recording-indicator")
      .classList.add("active");
  }

  stopRecording() {
    this.mediaRecorder.stop();
    this.shadowRoot.querySelector(".start-record-btn").disabled = false;
    this.shadowRoot.querySelector(".stop-record-btn").disabled = true;
    this.shadowRoot
      .querySelector(".recording-indicator")
      .classList.remove("active");
  }

  showNamingModal() {
    const modal = this.shadowRoot.getElementById("naming-modal");
    const input = this.shadowRoot.getElementById("file-name");
    input.value = `recording_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    modal.style.display = "flex";
  }

  hideNamingModal() {
    this.shadowRoot.getElementById("naming-modal").style.display = "none";
  }

  async saveRecordingWithName() {
    const name = this.shadowRoot.getElementById("file-name").value || "unnamed";
    const blob = new Blob(this.audioChunks, { type: "audio/webm" });
    const fileName = `${name}.webm`;

    if (this.directoryHandle) {
      const fileHandle = await this.directoryHandle.getFileHandle(fileName, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TalkRecorder/${fileName}`;
      a.click();
      URL.revokeObjectURL(url);
    }

    this.recordings.push({ fileName, timestamp: new Date().toISOString() });
    this.saveDataToJson();
    this.updateRecordingsList();
    this.hideNamingModal();
  }

  async saveDataToJson() {
    if (!this.directoryHandle) return;
    const data = {
        owner: this.owner,
        chats: this.chats.map(chat => ({
            ...chat,
            name: chat.text.split("\n")[0]  // Guardar la primera línea como nombre
        })),
        recordings: this.recordings,
    };
    const fileHandle = await this.directoryHandle.getFileHandle(
        "talkrecorder_data.json",
        { create: true }
    );
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
}

async loadDataFromJson() {
    if (!this.directoryHandle) return;
    try {
        const fileHandle = await this.directoryHandle.getFileHandle(
            "talkrecorder_data.json"
        );
        const file = await fileHandle.getFile();
        const text = await file.text();
        const data = JSON.parse(text);
        this.owner = data.owner || "Unknown";
        this.chats = data.chats || [];
        this.recordings = data.recordings || [];
        const chatText = this.shadowRoot.getElementById("chat-text");
        chatText.value = this.chats.map((chat) => chat.text).join("\n");
        chatText.scrollTop = chatText.scrollHeight;
        this.updateRecordingsList();
        this.actualizarListaChats();  // Actualizar la lista de chats
    } catch (err) {
        console.log(
            "No se encontró un archivo JSON previo o está corrupto. Se creará uno nuevo."
        );
    }
}

 actualizarListaChats() {
    const chatList = this.shadowRoot.getElementById("chat-list");
    chatList.innerHTML = "";  // Limpiar la lista existente

    this.chats.forEach(chat => {
        const li = document.createElement("li");
        li.innerText = chat.name || chat.text.split("\n")[0];
        chatList.appendChild(li);
    });
}

  async updateRecordingsList() {
    const list = this.shadowRoot.getElementById("recordings");
    let html = "";
    if (this.directoryHandle && "values" in this.directoryHandle) {
      for await (const entry of this.directoryHandle.values()) {
        if (entry.kind === "file" && entry.name.endsWith(".webm")) {
          const fileHandle = await this.directoryHandle.getFileHandle(
            entry.name
          );
          const file = await fileHandle.getFile();
          const url = URL.createObjectURL(file);
          html += `
                        <li>
                            ${entry.name} (${new Date(
            file.lastModified
          ).toISOString()})
                            <button class="play-recording-direct" data-file-name="${
                              entry.name
                            }">Reproducir</button>
                        </li>
                    `;
        }
      }
    } else {
      html = this.recordings
        .map(
          (rec) => `
                <li>
                    ${rec.fileName} (${rec.timestamp})
                    <button class="play-recording">Reproducir (carga el archivo)</button>
                </li>
            `
        )
        .join("");
    }
    list.innerHTML = html;
  }

  async playRecordingDirect(fileName) {
    if (this.directoryHandle) {
      const fileHandle = await this.directoryHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.play();
    }
  }
}

customElements.define("talk-recorder-app", TalkRecorderApp);
