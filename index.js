require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 設定ファイル
const DATA_FILE = path.join(__dirname, 'bot-data.json');

// データ管理
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('データ読み込みエラー:', e);
  }
  return { sessions: {}, repos: {} };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getSessionId(channelId) {
  return loadData().sessions[channelId];
}

function setSessionId(channelId, sessionId) {
  const data = loadData();
  data.sessions[channelId] = sessionId;
  saveData(data);
}

function clearSession(channelId) {
  const data = loadData();
  delete data.sessions[channelId];
  saveData(data);
}

// プロジェクトの親ディレクトリ
const PROJECTS_ROOT = '/Users/yushi/Private';

function getRepo(channelId) {
  return loadData().repos[channelId] || PROJECTS_ROOT;
}

function listRepos() {
  try {
    const items = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
    return items
      .filter(item => item.isDirectory() && !item.name.startsWith('.'))
      .map(item => item.name);
  } catch (e) {
    console.error('リポジトリ一覧エラー:', e);
    return [];
  }
}

function setRepo(channelId, repoPath) {
  const data = loadData();
  data.repos[channelId] = repoPath;
  saveData(data);
}

// ボットが起動したとき
client.once('ready', () => {
  console.log(`ボット起動完了: ${client.user.tag}`);
});

// メッセージを受信したとき
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);
  const startsWithClaude = message.content.toLowerCase().startsWith('claude');

  if (!isMentioned && !startsWithClaude) return;

  console.log('メッセージ受信:', message.content);

  // プロンプトを抽出
  let prompt = message.content
    .replace(/<@!?\d+>/g, '')
    .replace(/<@&\d+>/g, '')
    .replace(/<#\d+>/g, '')
    .trim();

  if (startsWithClaude) {
    prompt = prompt.slice(6).trim();
  }

  console.log('プロンプト:', prompt);

  // 特殊コマンド: リセット
  if (prompt === 'reset' || prompt === 'リセット' || prompt === '新規') {
    clearSession(message.channel.id);
    await message.reply('会話をリセットしました。新しい会話を始めます。');
    return;
  }

  // 特殊コマンド: リポジトリ一覧
  if (prompt === 'repolist' || prompt === 'リポジトリ一覧' || prompt === '一覧') {
    const repos = listRepos();
    if (repos.length === 0) {
      await message.reply('リポジトリが見つかりません。');
      return;
    }
    const repoList = repos.map((r, i) => `${i + 1}. \`${r}\``).join('\n');
    await message.reply(
      `**利用可能なリポジトリ**\n${repoList}\n\n` +
      `使い方: \`@bot repo 名前\` または \`@bot repo 番号\``
    );
    return;
  }

  // 特殊コマンド: リポジトリ設定
  if (prompt.startsWith('repo ') || prompt.startsWith('リポジトリ ')) {
    let repoPath = prompt.replace(/^(repo|リポジトリ)\s+/, '').trim();

    // 番号で指定された場合
    const repos = listRepos();
    const num = parseInt(repoPath, 10);
    if (!isNaN(num) && num >= 1 && num <= repos.length) {
      repoPath = path.join(PROJECTS_ROOT, repos[num - 1]);
    }
    // 名前だけで指定された場合（フルパスでない場合）
    else if (!repoPath.startsWith('/')) {
      const match = repos.find(r => r.toLowerCase().includes(repoPath.toLowerCase()));
      if (match) {
        repoPath = path.join(PROJECTS_ROOT, match);
      }
    }

    if (fs.existsSync(repoPath)) {
      setRepo(message.channel.id, repoPath);
      await message.reply(`作業ディレクトリを設定しました: \`${repoPath}\``);
    } else {
      await message.reply(`ディレクトリが見つかりません: \`${repoPath}\`\n\`repolist\` で一覧を確認してください。`);
    }
    return;
  }

  // 特殊コマンド: セッション情報
  if (prompt === 'session' || prompt === 'セッション' || prompt === '状態') {
    const sessionId = getSessionId(message.channel.id);
    const repo = getRepo(message.channel.id);
    let replyText = `**現在の設定**\n` +
      `セッションID: \`${sessionId || 'なし（新規）'}\`\n` +
      `作業ディレクトリ: \`${repo}\``;
    if (sessionId) {
      replyText += `\n💡 ローカルで参加: \`claude -r ${sessionId}\``;
    }
    await message.reply(replyText);
    return;
  }

  // 特殊コマンド: ヘルプ
  if (prompt === 'help' || prompt === 'ヘルプ') {
    await message.reply(
      `**コマンド一覧**\n` +
      `• \`repolist\` - リポジトリ一覧を表示\n` +
      `• \`repo 名前/番号\` - 作業ディレクトリを設定\n` +
      `• \`リセット\` - 会話をリセット\n` +
      `• \`セッション\` - 現在の設定を表示\n` +
      `• \`ヘルプ\` - このヘルプを表示`
    );
    return;
  }

  if (!prompt) {
    await message.reply('何をしましょうか？（「ヘルプ」でコマンド一覧）');
    return;
  }

  // セッション情報を取得
  const existingSessionId = getSessionId(message.channel.id);
  const repo = getRepo(message.channel.id);
  const isNewSession = !existingSessionId;

  // 即時応答
  let statusContent =
    `📥 **受け付けました**\n` +
    `セッション: \`${existingSessionId || '新規'}\`\n` +
    `作業ディレクトリ: \`${repo}\``;

  // 既存セッションがある場合はローカル参加方法を表示
  if (existingSessionId) {
    statusContent += `\n💡 ローカルで参加: \`claude -r ${existingSessionId}\``;
  }

  // 新規セッションの場合はコマンド一覧を追加
  if (isNewSession) {
    statusContent += `\n\n**コマンド一覧**\n` +
      `• \`repolist\` - リポジトリ一覧\n` +
      `• \`repo 名前/番号\` - 作業ディレクトリ設定\n` +
      `• \`リセット\` - 会話リセット\n` +
      `• \`セッション\` - 現在の設定\n` +
      `• \`ヘルプ\` - コマンド一覧`;
  }

  const statusMessage = await message.reply(statusContent);

  console.log('Claude Code 実行開始');

  // 中間報告用タイマー
  const startTime = Date.now();
  let reportCount = 0;

  const progressTimer = setInterval(async () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    reportCount++;

    // 最初は1分後、以降は5分ごと
    if (reportCount === 1) {
      // 1分後の報告
      try {
        await statusMessage.edit(
          statusMessage.content + `\n🔄 まだ作業中です...（経過: ${minutes}分${seconds}秒）`
        );
      } catch (e) {
        console.error('中間報告エラー:', e);
      }
    }
  }, 60 * 1000); // 1分ごとにチェック（最初の1分後に報告）

  // 5分ごとの報告用タイマー
  const longProgressTimer = setInterval(async () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);

    try {
      await message.channel.send(`🔄 まだ作業中です...（経過: ${minutes}分）`);
    } catch (e) {
      console.error('中間報告エラー:', e);
    }
  }, 5 * 60 * 1000); // 5分ごと

  try {
    const result = await runClaudeCode(prompt, existingSessionId, message.channel.id, repo);

    clearInterval(progressTimer);
    clearInterval(longProgressTimer);

    // セッションIDを取得して表示
    const newSessionId = getSessionId(message.channel.id);

    // 結果を送信
    const sessionInfo = newSessionId
      ? `セッション: \`${newSessionId}\`\n💡 ローカルで参加: \`claude -r ${newSessionId}\``
      : '';
    const finalMessage = `✅ **完了しました**\n${sessionInfo}\n\n${result}`;

    if (finalMessage.length > 1900) {
      const chunks = splitMessage(result, 1800);
      await message.channel.send(`✅ **完了しました**\n${sessionInfo}`);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } else {
      await message.channel.send(finalMessage);
    }
  } catch (error) {
    clearInterval(progressTimer);
    clearInterval(longProgressTimer);
    console.error('エラー:', error);
    await message.channel.send(`❌ **エラーが発生しました**\n${error.message}`);
  }
});

// Claude Code を実行する関数
function runClaudeCode(prompt, existingSessionId, channelId, cwd) {
  return new Promise((resolve, reject) => {
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    let resumeFlag = '';
    if (existingSessionId) {
      resumeFlag = `--resume '${existingSessionId}'`;
    }

    const command = `export HOME=/Users/yushi && /Users/yushi/.nvm/versions/node/v22.12.0/bin/claude -p '${escapedPrompt}' ${resumeFlag} --output-format json < /dev/null`;

    console.log('実行コマンド:', command);
    console.log('作業ディレクトリ:', cwd);

    exec(command, {
      timeout: 30 * 60 * 1000, // 30分タイムアウト
      maxBuffer: 50 * 1024 * 1024,
      shell: '/bin/bash',
      cwd: cwd
    }, (error, stdout, stderr) => {
      console.log('stdout:', (stdout || '').slice(0, 500));
      if (stderr) console.log('stderr:', stderr.slice(0, 200));

      if (error && !stdout) {
        console.log('error:', error.message);
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        const response = JSON.parse(stdout);

        if (response.session_id) {
          setSessionId(channelId, response.session_id);
          console.log('セッションID保存:', response.session_id);
        }

        const resultText = response.result || response.text || response.content || stdout;
        resolve(resultText);
      } catch (e) {
        console.log('JSON parse error, returning raw output');
        resolve(stdout || '完了');
      }
    });
  });
}

// メッセージを分割する関数
function splitMessage(text, maxLength) {
  const chunks = [];
  let current = '';
  const lines = text.split('\n');

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLength) {
      if (current) chunks.push(current);
      current = line.length > maxLength ? line.slice(0, maxLength) : line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

// ボットを起動
client.login(process.env.DISCORD_TOKEN);
