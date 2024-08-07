let isInterrupted = false;
let socket;
let currentPath = "~"; // 초기 경로
let savePath = currentPath;
let isBaroka = false;

let autoScroll = true; // 스크롤 자동 이동 여부를 관리하는 플래그
let reconnectAttempts = 0; // 재연결 시도 횟수
const maxReconnectAttempts = 10; // 최대 재연결 시도 횟수

const barokaPath = window.barokaPath;
const username = window.username;
const sessionId = window.sessionId;

function connectWebSocket() {
  socket = new WebSocket("ws://" + window.location.host + "/terminal");

  socket.onopen = function () {
    console.log("WebSocket connection established");
    reconnectAttempts = 0;
    const enterMessage = {
      session: sessionId,
      messageType: "ENTER",
    };
    socket.send(JSON.stringify(enterMessage));
    appendOutput("SSH Session Connected\n", "output-line");
  };

  socket.onmessage = function (event) {
    const message = JSON.parse(event.data);
    if (message.messageType === "RESULT") {
      if (!isInterrupted) {
        appendOutput(message.data, "output-line");
      }
    } else if (message.messageType === "VI") {
      openEditor(message.data);
    } else if (message.messageType === "VI_CONTENT") {
      console.log("content = " + message.data);
      document.getElementById("modalEditor").value = message.data;
    } else if (message.messageType === "PATH") {
      currentPath = message.data;
      updatePrompt();
    } else if (message.messageType === "AUTOCOMPLETE") {
      handleAutocomplete(message.data);
    } else if (message.messageType === "EXIT") {
      window.location.href = "/";
    }
  };

  socket.onclose = function () {
    console.log("WebSocket connection closed");
    if (reconnectAttempts < maxReconnectAttempts) {
      setTimeout(() => {
        reconnectAttempts++;
        console.log(
          `Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`
        );
        connectWebSocket();
      }, 1000 * reconnectAttempts); // 점진적으로 재연결 시도 간격을 증가
    } else {
      appendOutput(
        "Failed to reconnect after multiple attempts. Please refresh the page.\n",
        "error-line"
      );
    }
  };

  socket.onerror = function (error) {
    console.log("WebSocket error: " + error.message);
  };
}

function sendCommand() {
  const commandInput = document.getElementById("command");
  const command = commandInput.value;

  isInterrupted = false;
  if (command.trim() === "clear") {
    clearOutput();
  } else {
    const commandMessage = {
      session: sessionId,
      messageType: "COMMAND",
      data: command,
    };
    socket.send(JSON.stringify(commandMessage));
    commandInput.value = "";
    commandInput.focus();
    autoScroll = true;
  }
}

function appendOutput(text, type = "output-line") {
  const outputArea = document.getElementById("output");
  const newElement = document.createElement("div");
  newElement.textContent = text;
  newElement.classList.add(type);
  outputArea.appendChild(newElement);

  const isScrolledToBottom =
    outputArea.scrollHeight - outputArea.clientHeight <=
    outputArea.scrollTop + 1;
  if (autoScroll || isScrolledToBottom) {
    scrollToBottom();
  }
}

function clearOutput() {
  const commandInput = document.getElementById("command");
  const outputArea = document.getElementById("output");
  outputArea.innerHTML = "";
  commandInput.value = "";
  commandInput.focus();
}

function getPrompt() {
  return `${username}@${currentPath}$`;
}

function updatePrompt() {
  document.getElementById("prompt").textContent = getPrompt();
}

function scrollToBottom() {
  const outputArea = document.getElementById("output");
  outputArea.scrollTop = outputArea.scrollHeight;
}

function handleAutocomplete(data) {
  const commandInput = document.getElementById("command");
  const currentCommand = commandInput.value;
  const autoCompleteOptions = data
    .split("\n")
    .filter((opt) => opt.trim() !== "");

  if (autoCompleteOptions.length === 1) {
    const commandParts = currentCommand.trim().split(" ");
    commandParts[commandParts.length - 1] = autoCompleteOptions[0];
    commandInput.value = commandParts.join(" ") + " ";
  } else if (autoCompleteOptions.length > 0) {
    appendOutput(autoCompleteOptions.join("\n"), "output-line");
  }

  commandInput.focus();
}

window.onload = function () {
  connectWebSocket();
  document.getElementById("command").focus();
  updatePrompt();

  const dragHandle = document.getElementById("drag-handle");
  dragHandle.addEventListener("mousedown", initDrag);

  const inputDragHandle = document.getElementById("input-drag-handle");
  inputDragHandle.addEventListener("mousedown", initInputDrag);
};

window.onbeforeunload = function () {
  if (socket && socket.readyState === WebSocket.OPEN) {
    const exitMessage = {
      session: sessionId,
      messageType: "EXIT",
      data: "exit",
    };
    socket.send(JSON.stringify(exitMessage));
    socket.close();
  }
};
document.addEventListener("keydown", function (event) {
  const commandInput = document.getElementById("command");
  const modalEditor = document.getElementById("modalEditor");

  if (event.target === commandInput) {
    if (event.key === "Enter") {
      if (event.shiftKey) {
        event.preventDefault();
        const start = commandInput.selectionStart;
        const end = commandInput.selectionEnd;
        commandInput.value =
          commandInput.value.substring(0, start) +
          "\n" +
          commandInput.value.substring(end);
        commandInput.selectionStart = commandInput.selectionEnd = start + 1;
        commandInput.focus();
      } else {
        event.preventDefault();
        sendCommand();
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
      autocomplete(commandInput);
    } else if (event.ctrlKey && event.key === "c") {
      event.preventDefault();
      isInterrupted = true;
      sendSignal("SIGINT");
    }
  } else if (event.target === modalEditor) {
    // 텍스트 영역에서는 기본 동작을 막지 않도록 함
    if (event.key === "Enter") {
      // 기본 동작으로 엔터키를 처리하도록 놔둠
    }
  }
});

document.addEventListener("input", function (event) {
  if (event.target.id === "command") {
    const textarea = event.target;
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  }
});

document.getElementById("output").addEventListener("scroll", function () {
  const outputArea = document.getElementById("output");
  const isScrolledToBottom =
    outputArea.scrollHeight - outputArea.clientHeight <=
    outputArea.scrollTop + 1;
  autoScroll = isScrolledToBottom;
});

function autocomplete(commandInput) {
  const command = commandInput.value;
  if (command.trim() !== "") {
    const commandMessage = {
      session: sessionId,
      messageType: "AUTOCOMPLETE",
      data: command,
    };
    socket.send(JSON.stringify(commandMessage));
  }
}

function sendSignal(signal) {
  const signalMessage = {
    session: sessionId,
    messageType: "SIGNAL",
    data: signal,
  };
  socket.send(JSON.stringify(signalMessage));
}

function initDrag(e) {
  startX = e.clientX;
  startWidth = parseInt(
    document.defaultView.getComputedStyle(sidebar).width,
    10
  );
  document.documentElement.addEventListener("mousemove", doDrag);
  document.documentElement.addEventListener("mouseup", stopDrag);
}

function doDrag(e) {
  let newWidth = startWidth - (e.clientX - startX);
  const minWidth = 200;

  if (newWidth < minWidth) {
    newWidth = minWidth;
  }

  sidebar.style.width = newWidth + "px";
}

function stopDrag(e) {
  document.documentElement.removeEventListener("mousemove", doDrag);
  document.documentElement.removeEventListener("mouseup", stopDrag);
}

function initInputDrag(e) {
  const inputContainer = document.getElementById("input-container");
  const outputContainer = document.getElementById("output");
  const startY = e.clientY;
  const startHeight = parseInt(
    document.defaultView.getComputedStyle(inputContainer).height,
    10
  );
  const startOutputHeight = parseInt(
    document.defaultView.getComputedStyle(outputContainer).height,
    10
  );
  document.documentElement.addEventListener("mousemove", doInputDrag);
  document.documentElement.addEventListener("mouseup", stopInputDrag);

  function doInputDrag(e) {
    let newHeight = startHeight + (startY - e.clientY);
    const minHeight = 40;
    const maxHeight = window.innerHeight - minHeight;

    if (newHeight < minHeight) {
      newHeight = minHeight;
    } else if (newHeight > maxHeight) {
      newHeight = maxHeight;
    }

    inputContainer.style.height = newHeight + "px";
    outputContainer.style.height =
      startOutputHeight - (newHeight - startHeight) + "px";
  }

  function stopInputDrag(e) {
    document.documentElement.removeEventListener("mousemove", doInputDrag);
    document.documentElement.removeEventListener("mouseup", stopInputDrag);
  }
}

function openEditor(fileName, element) {
  document.getElementById("editModal").style.display = "flex";
  const modalTitle = document.getElementById("modalTitle");
  console.log("@: " + fileName);
  if (fileName) {
    if (fileName === "baroka") {
      console.log("@: baroka here");
      modalTitle.value = fileName + ".sh";
      if (element) {
        fileName = element.textContent || element.innerText;
        modalTitle.value = fileName;
      }
      fetchFileContent(fileName, barokaPath);
      savePath = barokaPath;
      isBaroka = true;
    } else {
      modalTitle.value = fileName;
      modalTitle.ariaPlaceholder = fileName;
      fetchFileContent(fileName, currentPath);
      savePath = currentPath;
      isBaroka = false;
    }
  } else {
    modalTitle.ariaPlaceholder = "Untitled";
    document.getElementById("modalEditor").value = ""; // 비어있는 경우
    savePath = currentPath;
    isBaroka = false;
  }

  document.getElementById("modalTitle").focus();
}

function closeEditor() {
  document.getElementById("editModal").style.display = "none";
  document.getElementById("modalTitle").value = "";
}

function fetchFileContent(title, currentPath) {
  // 서버로부터 파일 내용을 가져오는 로직
  // 예: WebSocket을 사용하여 파일 내용을 요청하고 받음
  const vi = {
    title: title,
    remoteDir: currentPath,
  };
  const message = {
    session: sessionId,
    messageType: "VI_CONTENT",
    data: JSON.stringify(vi),
  };
  socket.send(JSON.stringify(message));
}

function quit() {
  closeEditor();
}

function saveAndQuit() {
  const title = document.getElementById("modalTitle").value;
  const content = document.getElementById("modalEditor").value;
  const vi = {
    operation: "SAVE",
    title: title,
    content: content,
    remoteDir: savePath,
    isBaroka: isBaroka,
  };
  const message = {
    session: sessionId,
    messageType: "VI_OPERATION",
    data: JSON.stringify(vi),
  };
  socket.send(JSON.stringify(message));
  alert("저장되었습니다.");
  closeEditor();
  updateFileList();
}

function updateFileList() {
  fetch(`/file-list?sessionId=${sessionId}`)
    .then((response) => response.text())
    .then((html) => {
      console.log(html); // 받은 HTML 조각을 로그로 확인
      document.getElementById("file-list").innerHTML = html;
    });
}

function runScript(element, scriptName) {
  element.classList.add("run-animation");
  setTimeout(() => {
    element.classList.remove("run-animation");
  }, 500); // 애니메이션 시간과 일치하도록 설정

  const command = `${barokaPath}/${scriptName}`;
  const commandMessage = {
    session: sessionId,
    messageType: "COMMAND",
    data: command,
  };
  socket.send(JSON.stringify(commandMessage));
  autoScroll = true;
}

function confirmDelete(fileName) {
  const confirmAction = confirm(`Are you sure you want to delete ${fileName}?`);
  if (confirmAction) {
    deleteFile(fileName);
  }
}

function deleteFile(fileName) {
  const command = `rm -rf ${barokaPath}/${fileName}`;
  const commandMessage = {
    session: sessionId,
    messageType: "COMMAND",
    data: command,
  };
  socket.send(JSON.stringify(commandMessage));
  updateFileList(); // 파일 목록 업데이트
}
