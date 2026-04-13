const express = require('express');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Redis connection - use REDIS_URL from environment
let redis;
try {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
    commandTimeout: 5000
  });
  redis.on('error', (err) => console.error('Redis连接错误:', err.message));
  redis.on('connect', () => console.log('Redis已连接'));
} catch (e) {
  console.error('Redis初始化失败:', e.message);
}

// In-memory fallback if Redis unavailable
let inMemoryData = { validPasswords: [], usedPasswords: [] };

// GET /api/passwords - 获取所有口令
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

// POST /api/passwords - 操作口令
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

// POST /api/validate - 验证口令
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
    
    // 标记为已使用
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

// DELETE /api/passwords - 清空所有口令
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
