const express = require('express');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ===================== Redis 连接（修复版） =====================
let redis;
try {
  // 直接读取 Railway 自动注入的 REDIS_URL，100% 兼容
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.error('❌ 未找到 REDIS_URL 环境变量');
  } else {
    console.log('✅ 正在连接 Redis:', redisUrl.replace(/:.*@/, ':*****@')); // 隐藏密码
    
    // 修复：Railway Redis 必须加 family: 4
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 15000,
      family: 4, // 关键修复！不加这个连不上 Railway Redis
    });

    redis.on('error', (err) => console.error('Redis 错误:', err.message));
    redis.on('connect', () => console.log('✅ Redis 已成功连接！'));
    redis.on('ready', () => console.log('✅ Redis 准备就绪！'));
  }
} catch (e) {
  console.error('Redis 初始化失败:', e.message);
}

// 内存备用（Redis 挂了也能用）
let inMemoryData = { validPasswords: [], usedPasswords: [] };

// ===================== 你的接口（完全不变） =====================

// GET /api/passwords
app.get('/api/passwords', async (req, res) => {
  try {
    let data;
    if (redis) {
      const raw = await redis.get('quiz_passwords');
      data = raw ? JSON.parse(raw) : inMemoryData;
    } else {
      data = inMemoryData;
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/passwords
app.post('/api/passwords', async (req, res) => {
  const { action, password, newPasswords } = req.body;
  
  try {
    let data;
    if (redis) {
      const raw = await redis.get('quiz_passwords');
      data = raw ? JSON.parse(raw) : inMemoryData;
    } else {
      data = inMemoryData;
    }
    
    switch (action) {
      case 'batchGenerate':
        data.validPasswords = [...data.validPasswords, ...(newPasswords || [])];
        break;
      case 'addSingle':
        if (password && !data.validPasswords.includes(password)) {
          data.validPasswords.push(password);
        }
        break;
      case 'markUsed':
        if (password && !data.usedPasswords.includes(password)) {
          data.usedPasswords.push(password);
        }
        break;
      case 'resetUsed':
        data.usedPasswords = [];
        break;
      case 'clearAll':
        data = { validPasswords: [], usedPasswords: [] };
        break;
      case 'sync':
        data = req.body;
        break;
      default:
        return res.status(400).json({ error: '未知操作' });
    }
    
    if (redis) {
      await redis.set('quiz_passwords', JSON.stringify(data));
    } else {
      inMemoryData = data;
    }
    
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/validate
app.post('/api/validate', async (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    return res.json({ valid: false, message: '请输入口令' });
  }
  
  try {
    let data;
    if (redis) {
      const raw = await redis.get('quiz_passwords');
      data = raw ? JSON.parse(raw) : inMemoryData;
    } else {
      data = inMemoryData;
    }
    
    if (!data.validPasswords.includes(password)) {
      return res.json({ valid: false, message: '口令无效' });
    }
    
    if (data.usedPasswords.includes(password)) {
      return res.json({ valid: false, message: '口令已使用' });
    }
    
    data.usedPasswords.push(password);
    
    if (redis) {
      await redis.set('quiz_passwords', JSON.stringify(data));
    } else {
      inMemoryData = data;
    }
    
    res.json({ valid: true, message: '验证成功' });
  } catch (e) {
    res.status(500).json({ valid: false, message: e.message });
  }
});

// DELETE /api/passwords
app.delete('/api/passwords', async (req, res) => {
  try {
    inMemoryData = { validPasswords: [], usedPasswords: [] };
    if (redis) {
      await redis.set('quiz_passwords', JSON.stringify(inMemoryData));
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 启动服务（Railway 自动端口）
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 服务启动成功，端口：${PORT}`);
});
