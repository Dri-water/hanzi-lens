// News-style headlines with the expected segmentation (" / " separated,
// whitespace ignored). Headlines are short, dense with abbreviations
// (国台办, 沪指) and full of proper nouns, so they make a good stress test.
//
// Add a case whenever you find a headline that segments badly.

export interface HeadlineCase {
  text: string;
  expect: string;
  note?: string;
}

export const HEADLINES: HeadlineCase[] = [
  // --- transliterated names --------------------------------------------------
  { text: "特朗普宣布对华加征关税", expect: "特朗普 / 宣布 / 对华 / 加征 / 关税" },
  { text: "唐纳德·特朗普再次当选美国总统", expect: "唐纳德·特朗普 / 再次 / 当选 / 美国 / 总统", note: "dot-joined full name" },
  { text: "马斯克旗下SpaceX成功发射星舰", expect: "马斯克 / 旗下 / SpaceX / 成功 / 发射 / 星舰" },
  { text: "习近平同法国总统马克龙举行会谈", expect: "习近平 / 同 / 法国 / 总统 / 马克龙 / 举行 / 会谈" },
  { text: "联合国秘书长古特雷斯呼吁加沙停火", expect: "联合国 / 秘书长 / 古特雷斯 / 呼吁 / 加沙 / 停火" },
  { text: "普京与泽连斯基通电话", expect: "普京 / 与 / 泽连斯基 / 通电话" },
  { text: "伊朗最高领袖哈梅内伊发表讲话", expect: "伊朗 / 最高 / 领袖 / 哈梅内伊 / 发表 / 讲话" },
  { text: "美国务卿鲁比奥访华", expect: "美 / 国务卿 / 鲁比奥 / 访华", note: "美 = US (abbr.); unseen name" },
  { text: "卡塔尔世界杯：阿根廷夺冠", expect: "卡塔尔 / 世界杯 / ： / 阿根廷 / 夺冠" },
  // --- Chinese personal names ------------------------------------------------
  { text: "外交部发言人毛宁就中美关系答记者问", expect: "外交部 / 发言人 / 毛宁 / 就 / 中美 / 关系 / 答记者问" },
  // --- abbreviations / contractions --------------------------------------------
  { text: "美联储宣布降息25个基点", expect: "美联储 / 宣布 / 降息 / 25 / 个 / 基点" },
  { text: "国台办回应民进党当局挑衅", expect: "国台办 / 回应 / 民进党 / 当局 / 挑衅" },
  { text: "两会期间代表委员热议新质生产力", expect: "两会 / 期间 / 代表 / 委员 / 热议 / 新质生产力" },
  { text: "央行下调存款准备金率0.5个百分点", expect: "央行 / 下调 / 存款准备金率 / 0.5 / 个 / 百分点" },
  { text: "泽连斯基会见美国防长", expect: "泽连斯基 / 会见 / 美国 / 防长" },
  // --- markets -----------------------------------------------------------------
  { text: "沪指收涨1.2% 创业板指涨超2%", expect: "沪指 / 收涨 / 1.2% / 创业板指 / 涨超 / 2%" },
  { text: "港股收跌 恒指跌超3%", expect: "港股 / 收跌 / 恒指 / 跌超 / 3%" },
  // --- mixed scripts / numbers -----------------------------------------------
  { text: "苹果发布iPhone 17系列新机", expect: "苹果 / 发布 / iPhone / 17 / 系列 / 新机", note: "新机 has no entry; popup shows 新 + 机" },
  { text: "中国女排3比0横扫日本队", expect: "中国 / 女排 / 3 / 比 / 0 / 横扫 / 日本队" },
  { text: "台风“摩羯”登陆海南", expect: "台风 / “ / 摩羯 / ” / 登陆 / 海南" },
  // --- traditional characters ------------------------------------------------
  { text: "美國總統川普宣布關稅新政", expect: "美國 / 總統 / 川普 / 宣布 / 關稅 / 新政" },
  // --- classic ambiguity -------------------------------------------------------
  { text: "研究生命起源", expect: "研究 / 生命 / 起源" },
  { text: "北京大学生前来应聘", expect: "北京 / 大学生 / 前来 / 应聘" },
];
