// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

console.info("server started");

const AINX_API_KEY = Deno.env.get("AINX_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ✅ 清洗模型输出（增强版）
function cleanModelOutput(text: string) {
  if (!text) return "";

  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "") // 移除思考过程
    .replace(/```json/gi, "")                 // 移除 markdown 标记
    .replace(/```/g, "")
    // 替换特殊空白字符(如 \u00A0)为普通空格，防止 JSON.parse 报错
    .replace(/[\u00A0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, " ")
    .trim();
}

// ✅ 提取 JSON
function extractJSON(text: string) {
  if (!text) return null;

  // 优先匹配数组结构 [...]
  let match = text.match(/\[[\s\S]*\]/);

  // 如果没找到数组，尝试匹配对象 {...}
  if (!match) {
    match = text.match(/\{[\s\S]*\}/);
  }

  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch (err) {
    console.error("JSON 解析失败:", err, "提取的文本:", match[0]);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  // 处理跨域 OPTIONS 请求
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ✅ 1. 获取 Authorization header
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ 2. 创建 Supabase client（带用户 JWT）
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // ✅ 3. 校验用户登录状态
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.info("当前用户:", user.id);

    const body = await req.json().catch(() => ({}));
    const rawText = body?.text || "";

    // 清洗输入文本
    const text = rawText
      .replace(/\s+/g, " ")
      .replace(/[^\S\r\n]+/g, " ")
      .trim();

    if (!text) {
      return new Response(
        JSON.stringify({ success: false, error: "未提供有效文本" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ 4. 调用 AINX 大模型接口
    const resp = await fetch("https://api.ainx.cc/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${AINX_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o", // 指定模型
        temperature: 0,  // 设置为 0 保证 JSON 输出更稳定
        stream: false,
        messages: [
          {
            role: "system",
            content: `你是一个基金文本解析助手。请从提供的OCR文本中执行以下任务：抽取所有基金信息，包括：基金名称：中文字符串（可含英文或括号），名称后常跟随金额数字。基金代码：6位数字（如果存在）。持有金额：数字格式（可能含千分位逗号或小数，如果存在）。持有收益：数字格式（可能含千分位逗号或小数，如果存在）。忽略无关文本。输出格式：以JSON数组形式返回结果，每个基金信息为一个对象，包含以下字段：- fundName（必填，字符串）- fundCode（可选，字符串，不存在时为空字符串）- holdAmounts（可选，字符串，不存在时为空字符串）- holdGains（可选，字符串，不存在时为空字符串）除了JSON结果外，不要输出任何多余内容。`
          },
          {
            role: "user",
            content: text
          }
        ],
      }),
    });

    // 检查 AI 接口是否请求成功
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`AI 接口请求失败 (${resp.status}): ${errorText}`);
    }

    const result = await resp.json();

    // 提取模型返回的内容
    const rawContent = result?.choices?.[0]?.message?.content || "";

    // ✅ 5. 解析并清洗 AI 返回的数据
    const cleaned = cleanModelOutput(rawContent);
    const parsed = extractJSON(cleaned);

    if (!parsed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "模型未返回合法 JSON",
          raw: rawContent
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!Array.isArray(parsed)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "返回结果不是数组",
          data: parsed
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 格式化确保每个字段的数据类型绝对安全
    const safeData = parsed.map((item: any) => ({
      fundName: String(item?.fundName || ""),
      fundCode: String(item?.fundCode || ""),
      holdAmounts: String(item?.holdAmounts || ""),
      holdGains: String(item?.holdGains || "")
    }));

    // ✅ 6. 成功响应
    return new Response(
      JSON.stringify({
        success: true,
        data: safeData,
        userId: user.id
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        }
      }
    );

  } catch (err: any) {
    console.error("服务端错误:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || "Unknown error"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
